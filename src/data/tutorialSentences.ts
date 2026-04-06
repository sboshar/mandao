import type { SentenceInput } from '../services/ingestion';

/** The first sentence is the one users walk through adding manually. */
export const TUTORIAL_SENTENCES: SentenceInput[] = [
  {
    chinese: '她花了很多钱买花。',
    english: 'She spent a lot of money buying flowers.',
    source: 'tutorial',
    tokens: [
      { surfaceForm: '她', pinyinNumeric: 'ta1', english: 'she', partOfSpeech: 'pronoun' },
      { surfaceForm: '花', pinyinNumeric: 'hua1', english: 'to spend', partOfSpeech: 'verb' },
      { surfaceForm: '了', pinyinNumeric: 'le5', english: 'completed action', partOfSpeech: 'particle' },
      { surfaceForm: '很', pinyinNumeric: 'hen3', english: 'very', partOfSpeech: 'adv' },
      { surfaceForm: '多', pinyinNumeric: 'duo1', english: 'many', partOfSpeech: 'adj' },
      { surfaceForm: '钱', pinyinNumeric: 'qian2', english: 'money', partOfSpeech: 'noun' },
      { surfaceForm: '买', pinyinNumeric: 'mai3', english: 'to buy', partOfSpeech: 'verb' },
      { surfaceForm: '花', pinyinNumeric: 'hua1', english: 'flower', partOfSpeech: 'noun' },
    ],
  },
  {
    chinese: '你好！你是哪国人？',
    english: 'Hello! What country are you from?',
    source: 'tutorial',
    tokens: [
      { surfaceForm: '你', pinyinNumeric: 'ni3', english: 'you', partOfSpeech: 'pronoun' },
      { surfaceForm: '好', pinyinNumeric: 'hao3', english: 'good', partOfSpeech: 'adj' },
      { surfaceForm: '你', pinyinNumeric: 'ni3', english: 'you', partOfSpeech: 'pronoun' },
      { surfaceForm: '是', pinyinNumeric: 'shi4', english: 'to be', partOfSpeech: 'verb' },
      { surfaceForm: '哪', pinyinNumeric: 'na3', english: 'which', partOfSpeech: 'pronoun' },
      { surfaceForm: '国', pinyinNumeric: 'guo2', english: 'country', partOfSpeech: 'noun' },
      { surfaceForm: '人', pinyinNumeric: 'ren2', english: 'person', partOfSpeech: 'noun' },
    ],
  },
  {
    chinese: '这件事不是他做的。',
    english: 'This matter was not something he did.',
    source: 'tutorial',
    tokens: [
      { surfaceForm: '这', pinyinNumeric: 'zhe4', english: 'this', partOfSpeech: 'pronoun' },
      { surfaceForm: '件', pinyinNumeric: 'jian4', english: 'measure word for matters', partOfSpeech: 'measure' },
      { surfaceForm: '事', pinyinNumeric: 'shi4', english: 'matter; affair', partOfSpeech: 'noun' },
      { surfaceForm: '不', pinyinNumeric: 'bu4', english: 'not', partOfSpeech: 'adv' },
      { surfaceForm: '是', pinyinNumeric: 'shi4', english: 'to be', partOfSpeech: 'verb' },
      { surfaceForm: '他', pinyinNumeric: 'ta1', english: 'he', partOfSpeech: 'pronoun' },
      { surfaceForm: '做', pinyinNumeric: 'zuo4', english: 'to do', partOfSpeech: 'verb' },
      { surfaceForm: '的', pinyinNumeric: 'de5', english: 'structural particle', partOfSpeech: 'particle' },
    ],
  },
];
