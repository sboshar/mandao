/**
 * Tone sandhi rules, as a fixed table (#196).
 *
 * DELIBERATELY NOT AN LLM DECISION. Sandhi is rule-governed — that is what makes
 * it sandhi — so a table gets it right every time, costs nothing, and never
 * varies between runs. A model would be slower, occasionally wrong about
 * something uncontroversial, and unable to say which rule the CODE actually
 * applied, which is the part worth explaining: the point is to describe what the
 * app did to this syllable, not what a model believes about Mandarin.
 *
 * The table documents rules the code does not apply as well as those it does,
 * so it reads as a reference rather than a mirror of the implementation. Each
 * entry says which it is.
 *
 * The rules themselves are uncontroversial and appear in any standard
 * description; the wording here follows Chao Yuen Ren, A Grammar of Spoken
 * Chinese (1968) and San Duanmu, The Phonology of Standard Chinese (2nd ed.,
 * 2007), so it can be checked rather than trusted.
 */

export type SandhiRuleId =
  | 'third-tone'
  | 'bu-before-fourth'
  | 'yi-before-fourth'
  | 'yi-before-others'
  | 'yi-unchanged'
  | 'half-third'
  | 'neutral-tone'
  | 'qi-ba-optional';

export interface SandhiRule {
  id: SandhiRuleId;
  /** Short label for a heading. */
  name: string;
  /** The rule itself, in one sentence. */
  statement: string;
  /** Why it happens, or what to listen for. */
  note?: string;
  /**
   * Whether this app rewrites the pinyin for it.
   *
   * False does not mean the rule is wrong — half-third tone is real and
   * pervasive, it is simply not written in pinyin by convention. Saying so is
   * more useful than omitting it, because a learner WILL hear it.
   */
  applied: boolean;
}

export const SANDHI_RULES: Record<SandhiRuleId, SandhiRule> = {
  'third-tone': {
    id: 'third-tone',
    name: 'Third-tone sandhi',
    statement:
      'A third tone becomes a second tone when the syllable after it is also a third tone.',
    note:
      'Two full third tones cannot follow one another. In a longer run the grouping decides which change — 我很好 is normally wó hén hǎo, following the word boundaries.',
    applied: true,
  },
  'bu-before-fourth': {
    id: 'bu-before-fourth',
    name: '不 before a fourth tone',
    statement: '不 (bù) becomes bú when the syllable after it is a fourth tone.',
    note: 'Elsewhere it stays bù — 不好 is bù hǎo, not bú hǎo.',
    applied: true,
  },
  'yi-before-fourth': {
    id: 'yi-before-fourth',
    name: '一 before a fourth tone',
    statement: '一 (yī) becomes yí when the syllable after it is a fourth tone.',
    applied: true,
  },
  'yi-before-others': {
    id: 'yi-before-others',
    name: '一 before a first, second or third tone',
    statement:
      '一 (yī) becomes yì when the syllable after it is a first, second or third tone.',
    applied: true,
  },
  'yi-unchanged': {
    id: 'yi-unchanged',
    name: '一 keeps its first tone',
    statement:
      '一 stays yī when it is an ordinal, when counting or reciting digits, and at the end of a phrase.',
    note:
      'So 第一 is dì yī and 一月 is yī yuè, even though a fourth or first tone follows. This app does not detect these cases, so check 一 when it is not acting as "one of something".',
    applied: false,
  },
  'half-third': {
    id: 'half-third',
    name: 'Half-third tone',
    statement:
      'A third tone before any tone other than a third is pronounced low and level, without the rise back up.',
    note:
      'Real and pervasive, but pinyin does not write it — 好吃 is still written hǎo chī. Worth knowing because the full dipping contour only appears in isolation or before a pause.',
    applied: false,
  },
  'neutral-tone': {
    id: 'neutral-tone',
    name: 'Neutral tone',
    statement:
      'Some syllables carry no tone of their own and are pronounced short and light.',
    note:
      'NOT sandhi. It is part of how a word is stored — 休息 is xiū xi because that is the word, not because of what surrounds it. Listed here to keep the distinction clear.',
    applied: false,
  },
  'qi-ba-optional': {
    id: 'qi-ba-optional',
    name: '七 and 八 before a fourth tone',
    statement:
      '七 (qī) and 八 (bā) were once said as qí and bá before a fourth tone.',
    note:
      'Largely gone from modern standard speech and treated as optional. This app leaves them alone.',
    applied: false,
  },
};

/** The rules this app actually rewrites pinyin for. */
export const APPLIED_RULES = Object.values(SANDHI_RULES).filter((r) => r.applied);
