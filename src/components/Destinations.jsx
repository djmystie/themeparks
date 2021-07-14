import API from '../api/api'
import { useQuery } from 'react-query'

export default function Destinations({setResort}){
    const destinations = useQuery("destinations", () => 
    API.get("/destinations")
  .then(res => res.data.destinations), {staleTime: Infinity})


  if(destinations.isError){
      console.log(destinations.error)
      return null
  }

  return destinations.isLoading
  ?(
      <h3>Loading...</h3>
  )
  : (
      <ul>
          {destinations?.data.map(resort => (
              <li key={resort.id} onClick={()=>setResort(resort)}>{resort.name}</li>
          ))}
      </ul>
  )

}