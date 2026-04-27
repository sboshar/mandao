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
import { getRecordingCapMs } from '../stores/audioCacheSettingsStore';

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

const DownloadingSpinner = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M4.93 4.93l2.83 2.83" />
    <path d="M16.24 16.24l2.83 2.83" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
    <path d="M4.93 19.07l2.83-2.83" />
    <path d="M16.24 7.76l2.83-2.83" />
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
  // Recording id → resolved Blob. Eagerly populated alongside recordings so
  // play clicks can read the blob synchronously and call audio.play() inside
  // the user-gesture context — required by iOS Safari, where any await
  // between the click and play() rejects unmuted audio playback.
  const [blobMap, setBlobMap] = useState<Map<string, Blob>>(new Map());
  const [playingId, setPlayingId] = useState<string | null>(null); // 'default' or recording.id
  const stopPlaybackRef = useRef<(() => void) | null>(null);

  // Inline recording state
  const [recordHandle, setRecordHandle] = useState<RecordingHandle | null>(null);
  // Mirror of recordHandle for cleanup — effect cleanups see stale state.
  const recordHandleRef = useRef<RecordingHandle | null>(null);
  const [pendingClip, setPendingClip] = useState<RecordingResult | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const canRecord = isAudioRecordingSupported();

  const loadRecordingsAndBlobs = async (cancelledRef: { current: boolean }) => {
    const recs = await repo.getAudioRecordingsBySentence(sentenceId);
    if (cancelledRef.current) return;
    setRecordings(recs);
    const map = new Map<string, Blob>();
    await Promise.all(
      recs.map(async (r) => {
        const blob = await repo.fetchAudioBlob(r.id);
        if (blob) map.set(r.id, blob);
      }),
    );
    if (!cancelledRef.current) setBlobMap(map);
  };

  const refresh = async () => {
    await loadRecordingsAndBlobs({ current: false });
  };

  useEffect(() => {
    const cancelledRef = { current: false };
    loadRecordingsAndBlobs(cancelledRef);
    return () => {
      cancelledRef.current = true;
      stopPlaybackRef.current?.();
      stopSpeaking();
      // Release the mic if the user navigates away mid-recording.
      recordHandleRef.current?.cancel();
      recordHandleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Synchronous when the blob is already in blobMap (the common case
  // after the eager load on mount). The click → audio.play() chain stays
  // inside iOS's user-gesture context and uses the blob URL as the FIRST
  // play of the shared element — iOS authorizes it on first sight.
  //
  // We deliberately do NOT call unlockAudio() here: it sets src to
  // /silent.mp3 and starts a play, then this function immediately
  // overrides src and starts another play. iOS rejects the rapid
  // src-swap-mid-load and never authorizes the element. Without
  // unlockAudio, the first thing iOS sees on this element is the user's
  // blob play, which it accepts cleanly.
  const playRecording = (rec: AudioRecording) => {
    if (playingId === rec.id) { stopAll(); return; }
    stopAll();

    const cached = blobMap.get(rec.id);
    if (cached) {
      setPlayingId(rec.id);
      stopPlaybackRef.current = playBlob(cached, () => {
        setPlayingId((cur) => (cur === rec.id ? null : cur));
      });
      return;
    }

    // Blob not yet loaded — fall back to async fetch (rare; only happens
    // if the user taps before the eager-load effect finishes).
    setDownloadingId(rec.id);
    void (async () => {
      try {
        const blob = await repo.fetchAudioBlob(rec.id);
        if (!blob) {
          setError('Could not load this recording.');
          return;
        }
        setBlobMap((m) => {
          const next = new Map(m);
          next.set(rec.id, blob);
          return next;
        });
        setPlayingId(rec.id);
        stopPlaybackRef.current = playBlob(blob, () => {
          setPlayingId((cur) => (cur === rec.id ? null : cur));
        });
      } finally {
        setDownloadingId((cur) => (cur === rec.id ? null : cur));
      }
    })();
  };

  const defaultName = () => `Recording ${recordings.length + 1}`;

  const handlePlusClick = async () => {
    setError('');
    if (pendingClip || recordHandle) return;
    try {
      const handle = await startRecording({
        maxDurationMs: getRecordingCapMs(),
        onDurationCap: () => {
          // Auto-finalize when the cap fires; mirrors what handleStopRecord does.
          handle.stop().then((result) => {
            recordHandleRef.current = null;
            setRecordHandle(null);
            setPendingClip(result);
            setPendingName(defaultName());
          }).catch(() => {});
        },
      });
      recordHandleRef.current = handle;
      setRecordHandle(handle);
    } catch (e: any) {
      setError(e?.message || 'Could not access microphone.');
    }
  };

  const handleStopRecord = async () => {
    if (!recordHandle) return;
    try {
      const result = await recordHandle.stop();
      recordHandleRef.current = null;
      setRecordHandle(null);
      setPendingClip(result);
      setPendingName(defaultName());
    } catch (e: any) {
      setError(e?.message || 'Recording failed.');
      recordHandleRef.current = null;
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
      mimeType: pendingClip.mimeType,
      durationMs: pendingClip.durationMs,
      source: 'manual',
      createdAt: Date.now(),
    };
    await repo.insertAudioRecording(rec, pendingClip.blob);
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
    <div
      className={`inline-flex flex-col items-center gap-1 ${className}`}
      // Stop click bubbling: parents like BrowsePage wrap the whole sentence
      // row in a `<button>` whose onClick toggles expansion. Without this,
      // tapping a play / record button inside us would also fire the parent
      // collapse handler, which unmounts this component and triggers our
      // useEffect cleanup — pausing audio milliseconds after it starts.
      onClick={(e) => e.stopPropagation()}
    >
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
          const downloading = downloadingId === rec.id;
          const confirming = confirmDeleteId === rec.id;
          return (
            <div key={rec.id} className="flex flex-col items-center">
              <button
                onClick={() => playRecording(rec)}
                disabled={downloading}
                className="inline-flex items-center justify-center transition-all active:scale-90"
                style={iconBtnStyle(active)}
                title={active ? 'Stop' : downloading ? 'Downloading…' : `Play "${rec.name}"`}
              >
                {downloading ? DownloadingSpinner : active ? StopIcon : SpeakerIcon}
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
