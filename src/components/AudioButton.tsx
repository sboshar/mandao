import { useState } from 'react';
import { speakChinese, stopSpeaking } from '../services/audio';

const PlayIcon = (
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

interface AudioButtonProps {
  text: string;
  className?: string;
  rate?: number;
}

export function AudioButton({ text, className = '', rate }: AudioButtonProps) {
  const [playing, setPlaying] = useState(false);

  const handleClick = async () => {
    if (playing) {
      stopSpeaking();
      setPlaying(false);
      return;
    }

    setPlaying(true);
    try {
      await speakChinese(text, rate);
    } catch {
      // TTS may fail silently
    }
    setPlaying(false);
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center justify-center
        transition-all active:scale-90 ${className}`}
      style={{
        color: playing ? 'var(--danger)' : 'var(--text-secondary)',
        background: 'none',
        border: 'none',
        padding: 4,
        cursor: 'pointer',
      }}
      title={playing ? 'Stop audio' : 'Play audio'}
    >
      {playing ? StopIcon : PlayIcon}
    </button>
  );
}
