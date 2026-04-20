import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runAuditInConsole, runRepairInConsole } from './lib/auditPinyin'

const w = window as unknown as {
  __auditPinyin?: () => Promise<unknown>
  __repairPinyin?: () => Promise<unknown>
}
w.__auditPinyin = runAuditInConsole
w.__repairPinyin = runRepairInConsole

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
