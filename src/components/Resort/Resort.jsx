import API from '../../api/api'
import { useQuery } from 'react-query'

export default function Resort({resort, setPark}){
    const resortData = useQuery(resort, () => 
    API.get(`entity/${resort}/children`)
  .then(res => res.data), {staleTime: 300000})
  return resortData.isLoading
  ?(
      <h3>Loading...</h3>
  )
  : (
      <ul>
          {resortData.data.children.filter(type => type.entityType === "PARK").map(entity => (
              <li key={entity.id} onClick={()=>setPark(entity)}>{entity.name}</li>
          ))}
      </ul>
  )

}