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
        bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors
        ${className}`}
      title="Play audio"
    >
      {playing ? '...' : '🔊'}
    </button>
  );
}
