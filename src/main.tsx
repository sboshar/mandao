import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runAuditInConsole } from './lib/auditPinyin'

(window as unknown as { __auditPinyin?: () => Promise<unknown> }).__auditPinyin =
  runAuditInConsole

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
