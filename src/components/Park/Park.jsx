import API from '../../api/api'
import { useQuery } from 'react-query'
import './Park.scss'

export default function Resort({resort, park, type, setPark}){
    const parkData = useQuery(park.id, () => 
    API.get(`entity/${park.id}/live`)
  .then(res => res.data), {staleTime: 300000})
console.log(parkData)
let sorted = []
if(parkData.isSuccess){
    sorted = parkData.data.liveData.sort((a, b) => (a?.queue?.STANDBY?.waitTime < b?.queue?.STANDBY?.waitTime) ? 1 : -1)
}

  if(parkData.isError) { return null}

  return parkData.isLoading
  ?(
      <h3>Loading...</h3>
  )
  : (
      <div>
      <ul>
          {sorted.filter(a => a.entityType === type).map(entity => (
              type === "ATTRACTION"
              ? <li key={entity.id}>
                    <div className="attraction">
                      <div>{entity.name}<br/>{entity.status}</div>
                      <div className={`waitTime ${entity.status}`}>{entity?.queue?.STANDBY?.waitTime || "--"}</div>
                    </div>
                </li>
              : type === "SHOW"
              ? <li className={entity.status} key={entity.id}>{entity.name} - {entity?.queue?.STANDBY?.waitTime}</li>
              : <li></li>
          ))}
      </ul>
      </div>
  )

}