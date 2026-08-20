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

/**
 * A warning attached to one particular change, not to the rule in general.
 *
 * The rule statement is always true; whether this app applied it correctly HERE
 * is sometimes not. Where the answer depends on information the app does not
 * have, saying so beside the explanation is the honest option — the alternative
 * is a confident citation for a transformation that may be wrong, which is worse
 * than no explanation at all.
 */
export type SandhiCaveatId = 'long-third-run';

export const SANDHI_CAVEATS: Record<SandhiCaveatId, string> = {
  'long-third-run':
    'Three or more third tones in a row: which ones raise depends on how the ' +
    'words group, and this app applies the rule left to right without knowing ' +
    'the grouping. Worth checking this one yourself.',
};

export interface SandhiRule {
  id: SandhiRuleId;
  /** Short label for a heading. */
  name: string;
  /** The rule itself, in one sentence. */
  statement: string;
  /** Why it happens, or what to listen for. */
  note?: string;
  /**
   * Where to read the rule stated by somebody other than this app.
   *
   * A one-line statement in a popover is enough to act on and not enough to
   * understand, and the caveats especially invite a follow-up question this app
   * has no room to answer. Linking out is also what makes the table checkable
   * rather than something the learner has to take on trust.
   */
  readMore?: { label: string; url: string }[];
  /**
   * Whether this app rewrites the pinyin for it.
   *
   * False does not mean the rule is wrong — half-third tone is real and
   * pervasive, it is simply not written in pinyin by convention. Saying so is
   * more useful than omitting it, because a learner WILL hear it.
   */
  applied: boolean;
}

/**
 * Repeated on both 一 rules so it actually reaches the reader.
 *
 * The 'yi-unchanged' entry below states the same thing, but rules the code does
 * not apply never surface in the UI — an explanation only appears when a change
 * fired. Since the change that fires here is exactly the one that is wrong in
 * these contexts (一月 comes out yí yuè), the caveat has to travel with the
 * applied rules or a learner would never see it.
 */
/**
 * Wikipedia's phonology article, which states each of these rules with section
 * anchors that line up with the table below. Chosen over a textbook because a
 * learner can actually open it, and over a course site because the anchors are
 * stable and it cites its own sources.
 */
const WIKI = 'https://en.wikipedia.org/wiki/Standard_Chinese_phonology';
const WIKI_SPECIAL = { label: 'Wikipedia: 不 and 一', url: `${WIKI}#Tones_on_special_syllables` };

const YI_CONTEXT_NOTE =
  '一 keeps its first tone when it is an ordinal, a date, or a digit being ' +
  'read out, and this app cannot tell those apart — 第一 is dì yī and 一月 is ' +
  'yī yuè. Trust this only where 一 means "one of something".';

export const SANDHI_RULES: Record<SandhiRuleId, SandhiRule> = {
  'third-tone': {
    id: 'third-tone',
    name: 'Third-tone sandhi',
    statement:
      'A third tone becomes a second tone when the syllable after it is also a third tone.',
    note:
      'Two full third tones cannot follow one another. The syllable that changes keeps its written third tone in the dictionary — only the pronunciation moves.',
    readMore: [
      { label: 'Wikipedia: third-tone sandhi', url: `${WIKI}#Third_tone_sandhi` },
    ],
    applied: true,
  },
  'bu-before-fourth': {
    id: 'bu-before-fourth',
    name: '不 before a fourth tone',
    statement: '不 (bù) becomes bú when the syllable after it is a fourth tone.',
    note:
      'Before any other tone it stays bù — 不好 is bù hǎo. The exception is an A-不-A question — the "X or not X" way of asking yes/no, like 好不好 or 是不是 — where 不 is unstressed and flattens to a neutral bu: hǎo bu hǎo, shì bu shì.',
    readMore: [
      WIKI_SPECIAL,
      {
        label: 'A-不-A questions',
        url: 'https://resources.allsetlearning.com/chinese/grammar/Affirmative-negative_question',
      },
    ],
    applied: true,
  },
  'yi-before-fourth': {
    id: 'yi-before-fourth',
    name: '一 before a fourth tone',
    statement: '一 (yī) becomes yí when the syllable after it is a fourth tone.',
    note: YI_CONTEXT_NOTE,
    readMore: [WIKI_SPECIAL],
    applied: true,
  },
  'yi-before-others': {
    id: 'yi-before-others',
    name: '一 before a first, second or third tone',
    statement:
      '一 (yī) becomes yì when the syllable after it is a first, second or third tone.',
    note: YI_CONTEXT_NOTE,
    readMore: [WIKI_SPECIAL],
    applied: true,
  },
  'yi-unchanged': {
    id: 'yi-unchanged',
    name: '一 keeps its first tone',
    statement:
      '一 stays yī when it is an ordinal, when counting or reciting digits, and at the end of a phrase.',
    note:
      'So 第一 is dì yī and 一月 is yī yuè, even though a fourth or first tone follows. This app does not detect these cases; the caveat is repeated on the two 一 rules above, which are the ones a learner will actually see fire.',
    readMore: [WIKI_SPECIAL],
    applied: false,
  },
  'half-third': {
    id: 'half-third',
    name: 'Half-third tone',
    statement:
      'A third tone before any tone other than a third is pronounced low and level, without the rise back up.',
    note:
      'Real and pervasive, but pinyin does not write it — 好吃 is still written hǎo chī. Worth knowing because the full dipping contour only appears in isolation or before a pause.',
    readMore: [{ label: 'Wikipedia: the third tone', url: `${WIKI}#Third_tone` }],
    applied: false,
  },
  'neutral-tone': {
    id: 'neutral-tone',
    name: 'Neutral tone',
    statement:
      'Some syllables carry no tone of their own and are pronounced short and light.',
    note:
      'NOT sandhi. It is part of how a word is stored — 休息 is xiū xi because that is the word, not because of what surrounds it. Listed here to keep the distinction clear.',
    readMore: [{ label: 'Wikipedia: neutral tone', url: `${WIKI}#Neutral_tone` }],
    applied: false,
  },
  'qi-ba-optional': {
    id: 'qi-ba-optional',
    name: '七 and 八 before a fourth tone',
    statement:
      '七 (qī) and 八 (bā) were once said as qí and bá before a fourth tone.',
    note:
      'Largely gone from modern standard speech and treated as optional. This app leaves them alone.',
    readMore: [WIKI_SPECIAL],
    applied: false,
  },
};

/** The rules this app actually rewrites pinyin for. */
export const APPLIED_RULES = Object.values(SANDHI_RULES).filter((r) => r.applied);
