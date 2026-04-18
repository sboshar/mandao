import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import * as repo from '../db/repo';
import type { AudioRecording } from '../db/schema';
import { speakChinese, stopSpeaking } from '../services/audio';
import {
  isAudioRecordingSupported,
  playBlob,
  startRecording,
  type RecordingHandle,
  type RecordingResult,
} from '../services/audioRecording';

const SpeakerIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const StopIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const PlusIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const RecordDot = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="6" />
  </svg>
);

interface Props {
  sentenceId: string;
  text: string;
  rate?: number;
  className?: string;
}

/**
 * Audio controls for a sentence: the default Google-TTS playback button,
 * one button per saved recording (same icon + label underneath), and a
 * trailing + button that starts a new recording inline.
 */
export function SentenceAudioControls({ sentenceId, text, rate, className = '' }: Props) {
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null); // 'default' or recording.id
  const stopPlaybackRef = useRef<(() => void) | null>(null);

  // Inline recording state
  const [recordHandle, setRecordHandle] = useState<RecordingHandle | null>(null);
  const [pendingClip, setPendingClip] = useState<RecordingResult | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const canRecord = isAudioRecordingSupported();

  const refresh = async () => {
    const recs = await repo.getAudioRecordingsBySentence(sentenceId);
    setRecordings(recs);
  };

  useEffect(() => {
    let cancelled = false;
    repo.getAudioRecordingsBySentence(sentenceId).then((recs) => {
      if (!cancelled) setRecordings(recs);
    });
    return () => {
      cancelled = true;
      stopPlaybackRef.current?.();
      stopSpeaking();
    };
  }, [sentenceId]);

  const stopAll = () => {
    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
    stopSpeaking();
    setPlayingId(null);
  };

  const playDefault = async () => {
    if (playingId === 'default') { stopAll(); return; }
    stopAll();
    setPlayingId('default');
    try {
      await speakChinese(text, rate);
    } catch {}
    setPlayingId((cur) => (cur === 'default' ? null : cur));
  };

  const playRecording = (rec: AudioRecording) => {
    if (playingId === rec.id) { stopAll(); return; }
    stopAll();
    setPlayingId(rec.id);
    stopPlaybackRef.current = playBlob(rec.blob, () => {
      setPlayingId((cur) => (cur === rec.id ? null : cur));
    });
  };

  const defaultName = () => `Recording ${recordings.length + 1}`;

  const handlePlusClick = async () => {
    setError('');
    if (pendingClip || recordHandle) return;
    try {
      const handle = await startRecording();
      setRecordHandle(handle);
    } catch (e: any) {
      setError(e?.message || 'Could not access microphone.');
    }
  };

  const handleStopRecord = async () => {
    if (!recordHandle) return;
    try {
      const result = await recordHandle.stop();
      setRecordHandle(null);
      setPendingClip(result);
      setPendingName(defaultName());
    } catch (e: any) {
      setError(e?.message || 'Recording failed.');
      setRecordHandle(null);
    }
  };

  const handleSavePending = async () => {
    if (!pendingClip) return;
    const name = pendingName.trim() || defaultName();
    const rec: AudioRecording = {
      id: uuid(),
      sentenceId,
      name,
      blob: pendingClip.blob,
      mimeType: pendingClip.mimeType,
      durationMs: pendingClip.durationMs,
      source: 'manual',
      createdAt: Date.now(),
    };
    await repo.insertAudioRecording(rec);
    setPendingClip(null);
    setPendingName('');
    await refresh();
  };

  const handleDiscardPending = () => {
    setPendingClip(null);
    setPendingName('');
  };

  const handleDelete = async (id: string) => {
    if (playingId === id) stopAll();
    await repo.deleteAudioRecording(id);
    setConfirmDeleteId(null);
    await refresh();
  };

  const iconBtnStyle = (active: boolean) => ({
    color: active ? 'var(--danger)' : 'var(--text-secondary)',
    background: 'none',
    border: 'none',
    padding: 4,
    cursor: 'pointer',
  });

  const defaultActive = playingId === 'default';

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      <div className="inline-flex flex-wrap items-start justify-center gap-3">
        {/* Default Google TTS */}
        <div className="flex flex-col items-center">
          <button
            onClick={playDefault}
            className="inline-flex items-center justify-center transition-all active:scale-90"
            style={iconBtnStyle(defaultActive)}
            title={defaultActive ? 'Stop audio' : 'Play default voice (Google TTS)'}
          >
            {defaultActive ? StopIcon : SpeakerIcon}
          </button>
          <span className="text-[10px] leading-none" style={{ color: 'var(--text-tertiary)' }}>
            Default
          </span>
        </div>

        {/* Saved recordings */}
        {recordings.map((rec) => {
          const active = playingId === rec.id;
          const confirming = confirmDeleteId === rec.id;
          return (
            <div key={rec.id} className="flex flex-col items-center">
              <button
                onClick={() => playRecording(rec)}
                className="inline-flex items-center justify-center transition-all active:scale-90"
                style={iconBtnStyle(active)}
                title={active ? 'Stop' : `Play "${rec.name}"`}
              >
                {active ? StopIcon : SpeakerIcon}
              </button>
              <span className="text-[10px] leading-none max-w-[6rem] truncate"
                style={{ color: 'var(--text-tertiary)' }}>
                {rec.name}
              </span>
              {confirming ? (
                <span className="inline-flex items-center gap-1 mt-0.5 text-[10px]">
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="px-1 rounded"
                    style={{ background: 'var(--danger)', color: 'white' }}
                  >
                    delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-1 rounded"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(rec.id)}
                  className="text-[10px] leading-none mt-0.5 opacity-60 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  title={`Delete "${rec.name}"`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {/* + / recording control */}
        {canRecord && !pendingClip && (
          <div className="flex flex-col items-center">
            <button
              onClick={recordHandle ? handleStopRecord : handlePlusClick}
              className="inline-flex items-center justify-center transition-all active:scale-90"
              style={iconBtnStyle(!!recordHandle)}
              title={recordHandle ? 'Stop recording' : 'Add a new recording'}
            >
              {recordHandle ? RecordDot : PlusIcon}
            </button>
            <span className="text-[10px] leading-none" style={{ color: 'var(--text-tertiary)' }}>
              {recordHandle ? 'Recording…' : 'Add'}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>
      )}

      {pendingClip && (
        <div className="mt-2 p-3 rounded w-full max-w-sm space-y-2"
          style={{ background: 'var(--bg-inset)', border: '1px solid var(--accent)' }}>
          <label className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Name this recording
          </label>
          <input
            type="text"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSavePending(); }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="e.g. My voice, Native speaker"
            className="w-full px-2 py-2 rounded text-sm"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleDiscardPending}
              className="text-xs px-3 py-1 rounded"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              Discard
            </button>
            <button
              onClick={handleSavePending}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: 'var(--success)', color: 'var(--text-inverted)' }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
