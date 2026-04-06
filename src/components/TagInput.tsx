import { useState, useEffect, useRef } from 'react';
import { getAllTags } from '../services/ingestion';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Compact mode for inline use in browse/review */
  compact?: boolean;
}

export function TagInput({ tags, onChange, compact }: TagInputProps) {
  const [input, setInput] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAllTags().then(setAllTags);
  }, [tags]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const suggestions = input.trim()
    ? allTags.filter(
        (t) => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t)
      )
    : allTags.filter((t) => !tags.includes(t));

  const addTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized && !tags.includes(normalized)) {
      onChange([...tags, normalized]);
    }
    setInput('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.trim()) addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  const baseSize = compact ? 'text-xs' : 'text-sm';
  const pillPadding = compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5';
  const inputPadding = compact ? 'px-1 py-0.5' : 'px-2 py-1';

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex flex-wrap items-center gap-1 border rounded-lg ${inputPadding} bg-white
          focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500`}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-0.5 ${pillPadding} ${baseSize}
              bg-blue-100 text-blue-700 rounded-full`}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-blue-900 font-bold leading-none"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? (compact ? '+ tag' : 'Add tags (e.g. restaurant, travel)') : '+ tag'}
          className={`flex-1 min-w-[60px] ${baseSize} outline-none bg-transparent`}
        />
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-32 overflow-y-auto">
          {suggestions.slice(0, 8).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className={`w-full text-left px-3 py-1.5 ${baseSize} hover:bg-blue-50 transition-colors`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
