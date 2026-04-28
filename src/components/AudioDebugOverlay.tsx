import { useEffect, useState } from 'react';
import {
  audioDebugEnabled,
  getAudioDebugLog,
  subscribeAudioDebug,
  clearAudioDebugLog,
} from '../services/audioRecording';

/**
 * Floating overlay that surfaces every audio playback event in real
 * time when debug mode is on. Toggle is in Settings → Data → Audio
 * Diagnostic. Mounted at the app root so it stays visible across
 * navigation — tap a recording in Browse, see the events live
 * without DevTools.
 */
export function AudioDebugOverlay() {
  const [enabled, setEnabled] = useState(audioDebugEnabled);
  const [log, setLog] = useState<string[]>(getAudioDebugLog);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setEnabled(audioDebugEnabled());
      setLog(getAudioDebugLog());
    };
    refresh();
    return subscribeAudioDebug(refresh);
  }, []);

  if (!enabled) return null;

  return (
    <div
      className="fixed z-[9999] text-xs font-mono"
      style={{
        bottom: 8,
        left: 8,
        right: 8,
        maxHeight: collapsed ? 28 : '40vh',
        overflow: 'hidden',
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#9eff9e',
        border: '1px solid #444',
        borderRadius: 4,
        padding: '2px 6px',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          color: '#fff',
          borderBottom: collapsed ? 'none' : '1px solid #333',
          paddingBottom: 2,
          marginBottom: collapsed ? 0 : 2,
        }}
      >
        <span>audio debug ({log.length})</span>
        <span className="flex gap-2">
          <button onClick={() => clearAudioDebugLog()} style={{ color: '#aaa' }}>clear</button>
          <button onClick={() => setCollapsed((c) => !c)} style={{ color: '#aaa' }}>
            {collapsed ? '▲' : '▼'}
          </button>
        </span>
      </div>
      {!collapsed && (
        <div style={{ overflowY: 'auto', maxHeight: 'calc(40vh - 24px)' }}>
          {log.length === 0 ? (
            <div style={{ color: '#666' }}>(no events yet — tap a play button)</div>
          ) : (
            log.map((line, i) => (
              <div key={i} style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{line}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
