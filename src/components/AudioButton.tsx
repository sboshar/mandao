import { useState } from 'react';
import { speakChinese, stopSpeaking } from '../services/audio';

interface AudioButtonProps {
  text: string;
  className?: string;
}

export function AudioButton({ text, className = '' }: AudioButtonProps) {
  const [playing, setPlaying] = useState(false);

  const handleClick = async () => {
    if (playing) {
      stopSpeaking();
      setPlaying(false);
      return;
    }

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
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm
        transition-colors surface-hover ${className}`}
      style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
      title={playing ? 'Stop audio' : 'Play audio'}
    >
      {playing ? '\u25A0' : '\uD83D\uDD0A'}
    </button>
  );
}
