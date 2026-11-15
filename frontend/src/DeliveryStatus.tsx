import { useEffect, useState } from 'react'

/** Report readiness only after the entire versioned production cache installed. */
export function DeliveryStatus() {
  const [online,setOnline]=useState(navigator.onLine)
  const [ready,setReady]=useState(false)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine)
    window.addEventListener('online',update);window.addEventListener('offline',update)
    let active=true
    if(import.meta.env.PROD&&'serviceWorker' in navigator){
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(registration=>{
        const worker=registration.installing || registration.waiting
        if(worker){
          const changed=()=>{
            if(!active)return
            if(worker.state==='activated')setReady(true)
            if(worker.state==='redundant')setFailed(true)
          }
          worker.addEventListener('statechange',changed)
          changed()
        }else if(registration.active&&active)setReady(true)
      }).catch(()=>{if(active)setFailed(true)})
    }
    return()=>{active=false;window.removeEventListener('online',update);window.removeEventListener('offline',update)}
  },[])
  return <div role="status" className="fixed bottom-14 right-4 z-30 rounded-lg bg-black/80 px-2 py-1 text-[9px] text-slate-300 font-mono-tech pointer-events-none">
    {!online?'OFFLINE · ':''}{ready?'DEMO SAVED FOR OFFLINE':failed?'OFFLINE SAVE UNAVAILABLE':import.meta.env.PROD?'PREPARING OFFLINE DEMO…':'DEVELOPMENT PREVIEW'}
  </div>
}
