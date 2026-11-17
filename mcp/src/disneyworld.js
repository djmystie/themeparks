export const DESTINATION_ID = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';
export const TIMEZONE = 'America/New_York';
const normalise = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = { mk: 'Magic Kingdom Park', epcot: 'EPCOT', hs: "Disney's Hollywood Studios", ak: "Disney's Animal Kingdom Theme Park", wdw: 'Walt Disney World® Resort', disneyworld: 'Walt Disney World® Resort' };

export class DisneyWorld {
  constructor(api, { now = () => new Date() } = {}) { this.api = api; this.now = now; }

  async entities() {
    const data = await this.api.get(`entity/${DESTINATION_ID}/children`);
    if (!Array.isArray(data.children)) throw new Error('API returned an invalid Disney World entity listing.');
    return [{ id: DESTINATION_ID, name: data.name, entityType: 'DESTINATION', timezone: TIMEZONE }, ...data.children];
  }

  async resolve(query, type) {
    const rows = (await this.entities()).filter(row => !type || row.entityType === type);
    const needle = normalise(aliases[normalise(query)] ?? query);
    const exact = rows.filter(row => row.id === query || normalise(row.name) === needle || (row.slug && normalise(row.slug) === needle));
    const matches = exact.length ? exact : rows.filter(row => normalise(row.name).includes(needle));
    if (matches.length !== 1) {
      throw new Error(matches.length ? `Ambiguous entity. Use an exact name or id: ${matches.slice(0, 10).map(r => `${r.name} (${r.id})`).join('; ')}` : 'No matching Disney World entity. Use search_entities first; entities outside Disney World are not supported.');
    }
    return matches[0];
  }

  envelope(data, notes = []) {
    return { source: 'ThemeParks.wiki (third-party feed)', retrievedAt: this.now().toISOString(), timezone: TIMEZONE,
      notes: ['retrievedAt is the server response time; individual lastUpdated values reflect the source observation. Missing data is unknown, never zero.', ...notes], ...data };
  }

  async search({ query = '', type, park, limit = 25 }) {
    let rows = await this.entities();
    if (park) {
      const p = await this.resolve(park, 'PARK');
      rows = rows.filter(r => r.parkId === p.id || r.parentId === p.id || r.id === p.id);
    }
    rows = rows.filter(r => (!type || r.entityType === type) && normalise(r.name).includes(normalise(query)));
    return this.envelope({ total: rows.length, entities: rows.slice(0, limit) });
  }

  async details({ entity }) {
    const row = await this.resolve(entity);
    return this.envelope({ entity: await this.api.get(`entity/${row.id}`) }, ['Attributes such as height restrictions are available only when published.']);
  }

  async liveRows(entity) {
    const row = await this.resolve(entity);
    const data = await this.api.get(`entity/${row.id}/live`, {}, 60_000);
    if (!Array.isArray(data.liveData)) throw new Error('API returned invalid live data.');
    // The verified listing enforces scope even if upstream returns unexpected entities.
    const ids = new Set((await this.entities()).map(r => r.id));
    return { entity: row, rows: data.liveData.filter(r => ids.has(r.id)).map(r => {
      const timestamp = Date.parse(r.lastUpdated);
      const age = Number.isFinite(timestamp) ? Math.max(0, (this.now().getTime() - timestamp) / 1000) : null;
      return { ...r, dataAgeSeconds: age === null ? null : Math.floor(age), freshness: age === null ? 'unknown' : age > 300 ? 'stale' : 'recent' };
    }) };
  }

  async live({ entity = 'wdw', type, status, maxWait, limit = 100 }) {
    const data = await this.liveRows(entity);
    const rows = data.rows.filter(r => (!type || r.entityType === type) && (!status || r.status === status)
      && (maxWait === undefined || (r.status === 'OPERATING' && typeof r.queue?.STANDBY?.waitTime === 'number' && r.queue.STANDBY.waitTime <= maxWait)));
    rows.sort((a, b) => (a.queue?.STANDBY?.waitTime ?? Infinity) - (b.queue?.STANDBY?.waitTime ?? Infinity));
    return this.envelope({ entity: data.entity, total: rows.length, liveData: rows.slice(0, limit) }, ['Queue return windows, prices, forecasts and boarding groups are included only when supplied. No bookings can be made.']);
  }

  async hours({ entity, year, month }) {
    const row = await this.resolve(entity);
    if ((year === undefined) !== (month === undefined)) throw new Error('Supply both year and month, or neither.');
    const suffix = year === undefined ? '' : `/${year}/${String(month).padStart(2, '0')}`;
    return this.envelope({ entity: row, data: await this.api.get(`entity/${row.id}/schedule${suffix}`) }, ['Early entry and special ticketed events do not imply general admission access. Unpublished days are unknown.']);
  }

  async shows({ entity = 'wdw', after, limit = 100 }) {
    const data = await this.liveRows(entity);
    const cutoff = after ? new Date(after).getTime() : this.now().getTime();
    const rows = data.rows.filter(r => r.entityType === 'SHOW').map(r => ({ ...r,
      showtimes: (r.showtimes ?? []).filter(t => Date.parse(t.endTime ?? t.startTime) >= cutoff)
    })).filter(r => r.showtimes.length);
    rows.sort((a, b) => Date.parse(a.showtimes[0].startTime) - Date.parse(b.showtimes[0].startTime));
    return this.envelope({ entity: data.entity, total: rows.length, shows: rows.slice(0, limit) }, ['Showtime types are preserved: an Operating window is not a scheduled performance. No listed times means no data, not cancellation.']);
  }

  async dining({ entity = 'wdw', partySize, limit = 100 }) {
    const data = await this.liveRows(entity);
    const rows = data.rows.filter(r => r.entityType === 'RESTAURANT').map(r => ({ ...r,
      diningAvailability: (r.diningAvailability ?? []).filter(a => partySize === undefined || a.partySize === partySize)
    })).filter(r => r.diningAvailability.length);
    return this.envelope({ entity: data.entity, total: rows.length, restaurants: rows.slice(0, limit) }, ['These are published dining waits by party size, not reservation inventory or a booking service.']);
  }

  async history({ entity, mode = 'daily', date, from, to }) {
    const row = await this.resolve(entity);
    if (date && (from || to)) throw new Error('Use date or from/to, not both.');
    if (mode === 'coverage' && (date || from || to)) throw new Error('Coverage does not accept dates.');
    if (from && to && from > to) throw new Error('from must be on or before to.');
    const suffix = mode === 'raw' ? '' : `/${mode}`;
    return this.envelope({ entity: row, data: await this.api.get(`entity/${row.id}/history${suffix}`, { date, from, to }) }, [
      'History access depends on your API plan (documented: 7 days without a key, 30 with a free key). Missing days are not zero waits.',
      'Raw park history supports one local day per call. Daily park results may include a next page; use the dates indicated there to continue.',
      'Historical observations and forecasts do not guarantee future waits.'
    ]);
  }

  async recommend({ park, maxWait = 30, limit = 10 }) {
    const p = await this.resolve(park, 'PARK');
    const data = await this.liveRows(p.id);
    const rows = data.rows.filter(r => r.entityType === 'ATTRACTION' && r.status === 'OPERATING' && r.freshness === 'recent'
      && typeof r.queue?.STANDBY?.waitTime === 'number' && r.queue.STANDBY.waitTime <= maxWait);
    rows.sort((a, b) => a.queue.STANDBY.waitTime - b.queue.STANDBY.waitTime);
    return this.envelope({ park: p, total: rows.length, suggestions: rows.slice(0, limit) }, ['Ranked by lowest current published standby wait; excludes stale and unknown waits. Walking time, eligibility and personal preferences are not included. Check entity details for published restrictions.']);
  }
}
