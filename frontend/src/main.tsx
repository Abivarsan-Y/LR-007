import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeliveryStatus } from './DeliveryStatus'
import './index.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /><DeliveryStatus /></StrictMode>)
