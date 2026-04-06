import { useState } from 'react';
import { speakChinese } from '../services/audio';

interface AudioButtonProps {
  text: string;
  className?: string;
}

export function AudioButton({ text, className = '' }: AudioButtonProps) {
  const [playing, setPlaying] = useState(false);

  const handleClick = async () => {
    setPlaying(true);
    try {
      await speakChinese(text);
    } catch {
      // TTS failed silently
    }
    setPlaying(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={playing}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm
        disabled:opacity-50 transition-colors surface-hover ${className}`}
      style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
      title="Play audio"
    >
      {playing ? '...' : '\uD83D\uDD0A'}
    </button>
  );
}
