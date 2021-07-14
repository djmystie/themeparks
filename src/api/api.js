import axios from 'axios'

const API = axios.create({
    baseURL: 'https://api.themeparks.wiki/v1',
    headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        'Access-Control-Allow-Origin': '*',
        "Access-Control-Allow-Headers":"*"
      },
})

export default API