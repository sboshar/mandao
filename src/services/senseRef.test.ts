import { describe, it, expect } from 'vitest';
import {
  buildOfferedSenses,
  resolveSense,
  isUnexpectedNewSense,
  type SenseOption,
} from './senseRef';

const senses: SenseOption[] = [
  { headword: '意思', english: 'meaning', ref: '意思#1', id: 'm1' },
  { headword: '意思', english: 'a small gift', ref: '意思#2', id: 'm2' },
  { headword: '我', english: 'I', ref: '我#1', id: 'm3' },
];
const offered = buildOfferedSenses(senses);

describe('buildOfferedSenses', () => {
  it('groups by headword, preserving order', () => {
    expect(offered.get('意思')?.map((s) => s.ref)).toEqual(['意思#1', '意思#2']);
    expect(offered.get('我')?.map((s) => s.ref)).toEqual(['我#1']);
  });

  it('returns nothing for a headword with no stored senses', () => {
    expect(offered.get('沉浸')).toBeUndefined();
  });
});

describe('resolveSense', () => {
  it('reuses the referenced row and DISCARDS the model wording', () => {
    // The whole point: the model may reword freely and still land on one card.
    const r = resolveSense(
      { surfaceForm: '意思', english: 'sense', senseRef: '意思#1' },
      offered,
    );
    expect(r).toEqual({ kind: 'existing', meaningId: 'm1', english: 'meaning' });
  });

  it('distinguishes senses of the same headword', () => {
    const r = resolveSense(
      { surfaceForm: '意思', english: 'a token of appreciation', senseRef: '意思#2' },
      offered,
    );
    expect(r).toEqual({ kind: 'existing', meaningId: 'm2', english: 'a small gift' });
  });

  it('accepts a declared new sense and keeps the proposed gloss', () => {
    const r = resolveSense(
      { surfaceForm: '意思', english: 'intention', senseRef: 'new' },
      offered,
    );
    expect(r).toEqual({ kind: 'new', english: 'intention' });
  });

  it('treats an absent ref as new when nothing was offered', () => {
    // The common case — most tokens have no stored senses.
    const r = resolveSense({ surfaceForm: '沉浸', english: 'immersed' }, offered);
    expect(r).toEqual({ kind: 'new', english: 'immersed' });
  });

  it('REJECTS an absent ref when senses were offered', () => {
    // This is the duplicate-creating case: silently writing a fresh gloss for a
    // word that already has one.
    expect(() =>
      resolveSense({ surfaceForm: '意思', english: 'meaning' }, offered),
    ).toThrow(/no senseRef/);
  });

  it('rejects a ref whose headword is a different token', () => {
    // The ref repeats the headword precisely so crossed wires are catchable.
    expect(() =>
      resolveSense({ surfaceForm: '我', english: 'I', senseRef: '意思#1' }, offered),
    ).toThrow(/used on token/);
  });

  it('rejects an index that was never offered', () => {
    expect(() =>
      resolveSense({ surfaceForm: '意思', english: 'fun', senseRef: '意思#7' }, offered),
    ).toThrow(/was not offered/);
  });

  it('rejects a malformed ref', () => {
    expect(() =>
      resolveSense({ surfaceForm: '意思', english: 'x', senseRef: 'meaning' }, offered),
    ).toThrow(/Malformed/);
  });

  it('rejects a new sense with no gloss', () => {
    expect(() =>
      resolveSense({ surfaceForm: '意思', english: '  ', senseRef: 'new' }, offered),
    ).toThrow(/no english/);
  });

  it('tolerates surrounding whitespace in the ref', () => {
    const r = resolveSense(
      { surfaceForm: '我', english: 'me', senseRef: ' 我#1 ' },
      offered,
    );
    expect(r).toEqual({ kind: 'existing', meaningId: 'm3', english: 'I' });
  });
});

describe('isUnexpectedNewSense', () => {
  it('is true when a new sense is declared for a word that already has some', () => {
    expect(
      isUnexpectedNewSense({ surfaceForm: '意思', senseRef: 'new' }, offered),
    ).toBe(true);
  });

  it('is false for a word with no stored senses', () => {
    expect(
      isUnexpectedNewSense({ surfaceForm: '沉浸', senseRef: 'new' }, offered),
    ).toBe(false);
  });

  it('is false when an existing sense was chosen', () => {
    expect(
      isUnexpectedNewSense({ surfaceForm: '意思', senseRef: '意思#1' }, offered),
    ).toBe(false);
  });
});
