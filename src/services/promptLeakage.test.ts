import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The prompt must not contain the sentences it will be judged on.
 *
 * An example in the prompt teaches the model the answer, so a case that
 * overlaps one stops measuring reasoning and starts measuring recall. This has
 * gone wrong repeatedly — 咖啡, 东西, 马上, 上班, 非常, 我的书, 我吃了饭 and 忘我
 * all reached the prompt while being actively used as test material — because
 * the check was "look at it carefully", which does not scale past a few edits.
 *
 * ADD SENTENCES HERE when you start testing with them, before adding examples
 * to the prompt. The failure this prevents is silent: everything passes, the
 * results just mean less than they appear to.
 */
const RESERVED = [
  // Hand-run during the #185 prompt investigation.
  '他工作时非常忘我',
  '她读书忘我',
  '他走路上班',
  '他的衣服很干净',
  '这本书很便宜',
  '他还钱了',
  '他上公交车了',
  '我吃了他的苹果',
  '这件事很麻烦',
  '这个意思我懂',
  '这是我的一点意思',
  '我认识那个人',
  '天黑了',
  // From the gloss test set (test-data/glossTests.json).
  '他上班去了',
  '我每天上学',
  '他上车了',
  '我马上去',
  '今天下雨了',
  '我下班回家',
  '我给他打电话',
  '请打开窗户',
  '我去银行',
  '不行',
  '这件事很重要',
  '他长大了',
  '我还要去',
  '我去买东西',
  '这个词什么意思',
  '你怎么知道',
  '我看书',
  '我吃了饭',
  '我的书',
  '他的书在哪里',
  '我喝咖啡',
  '我吃汉堡',
];

/** Every CJK run of 2+ characters in the prompt template, comments stripped. */
function promptExamples(): string[] {
  const src = readFileSync(resolve(__dirname, 'llmPrompt.ts'), 'utf-8');
  const withoutBlockComments = src.replace(/\/\*\*[\s\S]*?\*\//g, '');
  const body = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '');
  return [...new Set(body.match(/[一-鿿]{2,}/g) ?? [])];
}

describe('prompt does not leak test material', () => {
  it('contains no multi-character example drawn from a reserved sentence', () => {
    const leaked = promptExamples().filter((ex) =>
      RESERVED.some((sentence) => sentence.includes(ex)),
    );
    expect(leaked).toEqual([]);
  });

  it('has examples to check, so the guard cannot pass vacuously', () => {
    expect(promptExamples().length).toBeGreaterThan(10);
  });
});
