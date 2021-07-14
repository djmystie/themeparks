import {
  QueryClient,
  QueryClientProvider,
  } from 'react-query'
import { ReactQueryDevtools } from "react-query/devtools";
import {useState, useEffect} from 'react'
import Header from './components/Header/'
import Destinations from './components/Destinations'
import Resort from './components/Resort/Resort'
import Park from './components/Park/Park'
import './App.scss'

const queryClient = new QueryClient()

function App() {
  let [resort, setResort] = useState(null)
  let [park, setPark] = useState(null)
  let [type, setType] = useState("ATTRACTION")
  let [title, setTitle] = useState("All Resorts")
  let [level, setLevel] = useState(null)

  useEffect(()=>{
    setTitle(park ? park.name : resort ? resort.name : "All Resorts")
    setLevel(park ? "park" : resort ? "resort" : null)
  },[resort, park])

  const goBack = () => {
    let newLevel = null
    if(level === "park"){
      setPark(null)
      newLevel = "resort"
    } else if(level === 'resort'){
      setResort(null)
    }
    setLevel(newLevel)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Header goBack={goBack} title={title} level={level} />
      {resort
        ? park 
        ? <Park resort={resort} park={park} type={type} setPark={setPark} />
        : <Resort resort={resort.slug} setPark={setPark} />
        : <Destinations setResort={setResort} />}
      <ReactQueryDevtools initialIsOpen={false} />
   
    </QueryClientProvider>
  );
}

export default App;
