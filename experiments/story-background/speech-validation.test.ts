import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSpeechTokens, speechTranscriptWarnings } from './speech-validation.js';

test('equivalent spoken numbers and transcript digits do not reject the real story', () => {
  const script = 'About seventy percent repeated. It took twenty minutes, then three people finished in under thirty minutes.';
  assert.deepEqual(speechTranscriptWarnings(script, 'About 70% repeated. It took 20 minutes, then three people finished in under 30 minutes.'), []);
  assert.deepEqual(canonicalSpeechTokens('seventy percent twenty thirty'), ['70', 'percent', '20', '30']);
});

test('bounded compound cardinals, signed decimals and percent spelling canonicalize', () => {
  for (const [spoken, digits] of [
    ['twenty-one', '21'], ['one hundred and five', '105'], ['a hundred', '100'],
    ['two thousand three hundred and forty-five', '2,345'], ['nine hundred ninety-nine thousand nine hundred ninety-nine', '999,999'],
    ['minus five point two five percent', '-5.25%'], ['zero point zero five per cent', '0.05 percent'],
    ['-5 point two', '-5.2'], ['-0 point five', '-0.5'],
  ]) assert.deepEqual(canonicalSpeechTokens(spoken!), canonicalSpeechTokens(digits!));
  assert.deepEqual(canonicalSpeechTokens('one and only'), ['1', 'and', 'only']);
  assert.notDeepEqual(canonicalSpeechTokens('twenty twenty six'), canonicalSpeechTokens('2026'));
  assert.notDeepEqual(canonicalSpeechTokens('one million'), canonicalSpeechTokens('1000000'));
});

test('actual numeric, sign, percent-unit and negation mismatches still fail', () => {
  for (const [script, heard] of [
    ['seventy percent', '17%'], ['twenty minutes', '30 minutes'], ['three people', 'two people'],
    ['minus five', 'five'], ['fifty percent', '50'], ['It is not safe.', 'It is safe.'],
    ['They never approved the expense.', 'They approved the expense.'], ['without ink', 'with ink'],
  ]) assert.ok(speechTranscriptWarnings(script!, heard!).length > 0, `${script} must differ from ${heard}`);
  assert.deepEqual(speechTranscriptWarnings("They don't print it.", 'They do not print it.'), []);
});

test('unrelated, missing and extra speech is not hidden by number normalization', () => {
  assert.ok(speechTranscriptWarnings('The last day in the office.', 'A different story about sailing.').length);
  assert.ok(speechTranscriptWarnings('Read this sentence.', '').length);
  assert.ok(speechTranscriptWarnings('', 'Extra spoken words.').length);
});
