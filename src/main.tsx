import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runAuditInConsole, runRepairInConsole } from './lib/auditPinyin'
import { runCleanOrphanedAudioInConsole } from './lib/cleanOrphanedAudio'
import { runCleanOrphanedMeaningsInConsole } from './lib/cleanOrphanedMeanings'

const w = window as unknown as {
  __auditPinyin?: () => Promise<unknown>
  __repairPinyin?: () => Promise<unknown>
  __cleanOrphanedAudio?: () => Promise<unknown>
  __cleanOrphanedMeanings?: () => Promise<unknown>
}
w.__auditPinyin = runAuditInConsole
w.__repairPinyin = runRepairInConsole
w.__cleanOrphanedAudio = runCleanOrphanedAudioInConsole
w.__cleanOrphanedMeanings = runCleanOrphanedMeaningsInConsole

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
