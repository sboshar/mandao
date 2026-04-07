import { useState, useRef, useEffect, useCallback } from 'react';
import { lookupByPinyin, type DictEntry } from '../lib/cedict';

interface PinyinIMEInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

/** Does the buffer end with a complete tone-numbered syllable? e.g. "wo3", "e4", "zhuang1" */
const TONE_SYLLABLE_RE = /[a-züü]{1,6}[1-5]$/i;

export function PinyinIMEInput({ value, onChange, placeholder, readOnly }: PinyinIMEInputProps) {
  const [pinyinBuf, setPinyinBuf] = useState('');
  const [candidates, setCandidates] = useState<DictEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoCommitRef = useRef(false);

  // Update candidates when pinyin buffer changes
  useEffect(() => {
    if (!pinyinBuf.trim()) {
      setCandidates([]);
      setSelectedIndex(0);
      return;
    }
    const results = lookupByPinyin(pinyinBuf.trim());
    // Deduplicate by simplified form
    const seen = new Set<string>();
    const deduped = results.filter((e) => {
      if (seen.has(e.simplified)) return false;
      seen.add(e.simplified);
      return true;
    });
    setCandidates(deduped);
    setSelectedIndex(0);

    // Auto-commit: if the buffer ends with a tone number and we have a single-char match, select it
    if (autoCommitRef.current && TONE_SYLLABLE_RE.test(pinyinBuf.trim()) && deduped.length > 0) {
      const top = deduped[0];
      // Only auto-commit single-character results for single syllables
      if (top.simplified.length === 1) {
        onChange(value + top.simplified);
        setPinyinBuf('');
        setCandidates([]);
        inputRef.current?.focus();
      }
    }
    autoCommitRef.current = false;
  }, [pinyinBuf, onChange, value]);

  const selectCandidate = useCallback(
    (entry: DictEntry) => {
      onChange(value + entry.simplified);
      setPinyinBuf('');
      setCandidates([]);
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (candidates.length === 0) {
      // Backspace with empty pinyin buffer → delete last character from value
      if (e.key === 'Backspace' && !pinyinBuf) {
        e.preventDefault();
        if (value.length > 0) {
          onChange(value.slice(0, -1));
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (candidates[selectedIndex]) {
        selectCandidate(candidates[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPinyinBuf('');
      setCandidates([]);
    } else if (e.key >= '1' && e.key <= '5') {
      // Tone numbers: let them through to the input buffer and flag for auto-commit
      autoCommitRef.current = true;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Display composed Chinese + active pinyin buffer */}
      <div className="flex items-center w-full px-3 py-2 border rounded-lg focus-within:ring-2
        focus-within:ring-blue-500 focus-within:border-blue-500 bg-white">
        {value && <span className="text-lg mr-1" lang="zh">{value}</span>}
        <input
          ref={inputRef}
          type="text"
          value={pinyinBuf}
          onChange={(e) => setPinyinBuf(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value ? '' : placeholder}
          className="flex-1 outline-none text-lg bg-transparent min-w-[60px]"
          readOnly={readOnly}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Candidate list */}
      {candidates.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg
          max-h-64 overflow-y-auto">
          {candidates.map((entry, i) => (
            <button
              key={`${entry.simplified}-${i}`}
              onClick={() => selectCandidate(entry)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 text-sm
                hover:bg-blue-50 ${i === selectedIndex ? 'bg-blue-50' : ''}`}
            >
              <span className="text-xl" lang="zh">{entry.simplified}</span>
              <span className="text-gray-400 text-xs">{entry.pinyin}</span>
              <span className="text-gray-500 text-xs truncate flex-1">{entry.english.split('/')[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
