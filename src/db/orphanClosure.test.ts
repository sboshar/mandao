import { describe, it, expect } from 'vitest';
import { computeOrphanClosure } from './localRepo';
import type { MeaningLink, SentenceToken } from './schema';

// Minimal factories — every field the function reads, nothing else.
// The schema carries extra fields (role, position, surfaceForm, usn)
// that the algorithm ignores, so we omit them via casts to keep the
// fixtures readable.
const link = (id: string, parent: string, child: string): MeaningLink =>
  ({ id, parentMeaningId: parent, childMeaningId: child }) as MeaningLink;

const token = (meaningId: string, sentenceId = 's1'): SentenceToken =>
  ({ id: `t-${sentenceId}-${meaningId}`, sentenceId, meaningId }) as SentenceToken;

describe('computeOrphanClosure', () => {
  it('returns empty when no candidates', () => {
    const r = computeOrphanClosure([], [], []);
    expect(r.meanings).toEqual([]);
    expect(r.links).toEqual([]);
  });

  it('removes a candidate with no parent link and no sentence_token', () => {
    const r = computeOrphanClosure(['m1'], [], []);
    expect(r.meanings).toEqual(['m1']);
    expect(r.links).toEqual([]);
  });

  it('preserves a candidate still referenced by a sentence_token', () => {
    const tokens = [token('m1', 's-other')];
    const r = computeOrphanClosure(['m1'], [], tokens);
    expect(r.meanings).toEqual([]);
    expect(r.links).toEqual([]);
  });

  it('preserves a candidate whose parent meaning is not in the candidate set', () => {
    // parent m-word still lives (not a candidate), child m1 stays with it
    const links = [link('l1', 'm-word', 'm1')];
    const r = computeOrphanClosure(['m1'], links, []);
    expect(r.meanings).toEqual([]);
    expect(r.links).toEqual([]);
  });

  it('transitively orphans a child once its only parent is an orphan', () => {
    // Compound word m-word has one child character m-char.
    // No sentence_tokens survive. Candidates are just the compound;
    // the character should get dragged along via transitive closure.
    const links = [link('l1', 'm-word', 'm-char')];
    const r = computeOrphanClosure(['m-word'], links, []);
    expect(new Set(r.meanings)).toEqual(new Set(['m-word', 'm-char']));
    expect(r.links).toEqual(['l1']);
  });

  it('handles a diamond: A orphans drag B, C, and the bridge link', () => {
    // A → B, A → C, B → C. Deleting A should orphan B and C, and
    // return all three links.
    const links = [
      link('l1', 'A', 'B'),
      link('l2', 'A', 'C'),
      link('l3', 'B', 'C'),
    ];
    const r = computeOrphanClosure(['A'], links, []);
    expect(new Set(r.meanings)).toEqual(new Set(['A', 'B', 'C']));
    expect(new Set(r.links)).toEqual(new Set(['l1', 'l2', 'l3']));
  });

  it('protects a child that has at least one living parent', () => {
    // Two parents for m-char: m-word-1 (candidate, will orphan) and
    // m-word-2 (not a candidate, lives). m-char should survive.
    const links = [
      link('l1', 'm-word-1', 'm-char'),
      link('l2', 'm-word-2', 'm-char'),
    ];
    const r = computeOrphanClosure(['m-word-1'], links, []);
    expect(r.meanings).toEqual(['m-word-1']);
    // l1 is incident to the orphan m-word-1 and is returned so the
    // caller removes the dead edge. l2 is untouched.
    expect(r.links).toEqual(['l1']);
  });

  it('token on the child keeps the child and its descendants alive', () => {
    // m-word is orphan; m-char is reachable from m-word but has its
    // own surviving sentence_token, so it must stay.
    const links = [link('l1', 'm-word', 'm-char')];
    const tokens = [token('m-char', 's-still-here')];
    const r = computeOrphanClosure(['m-word'], links, tokens);
    expect(r.meanings).toEqual(['m-word']);
    expect(r.links).toEqual(['l1']);
  });

  it('is order-insensitive when candidates are processed out of order', () => {
    // Same diamond as above, but seed candidates with the leaf first.
    // The fixed-point loop must still converge to the same result.
    const links = [
      link('l1', 'A', 'B'),
      link('l2', 'A', 'C'),
      link('l3', 'B', 'C'),
    ];
    const r = computeOrphanClosure(['C', 'B', 'A'], links, []);
    expect(new Set(r.meanings)).toEqual(new Set(['A', 'B', 'C']));
    expect(new Set(r.links)).toEqual(new Set(['l1', 'l2', 'l3']));
  });
});
