import { describe, it, expect } from 'vitest';
import { classifyError } from './ankiImport';

describe('classifyError', () => {
  it('tags 429 as rate-limit', () => {
    expect(classifyError({ status: 429, message: 'Too Many Requests' })).toBe('rate-limit');
  });

  it('tags "rate limit" in the message as rate-limit even without a status', () => {
    expect(classifyError(new Error('OpenAI rate limit exceeded'))).toBe('rate-limit');
    expect(classifyError(new Error('quota exceeded for gpt-4'))).toBe('rate-limit');
  });

  it('tags 5xx and network-ish errors as network', () => {
    expect(classifyError({ status: 503, message: 'Service Unavailable' })).toBe('network');
    expect(classifyError(new Error('fetch failed: ECONNRESET'))).toBe('network');
    expect(classifyError(new Error('network timeout'))).toBe('network');
  });

  it('tags parse errors distinctly so retry does not fire on bad LLM JSON', () => {
    expect(classifyError(new Error('Could not parse JSON response'))).toBe('llm-parse');
    expect(classifyError(new Error('invalid json at position 4'))).toBe('llm-parse');
  });

  it('unclassified errors fall through to "other"', () => {
    expect(classifyError(new Error('something weird'))).toBe('other');
    expect(classifyError('raw string error')).toBe('other');
  });

  it('reads wrapped response.status', () => {
    expect(classifyError({ response: { status: 429 } })).toBe('rate-limit');
  });
});
