import { transcriptWarnings } from '../../src/server/providers/editorial.js';

const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const negatives = new Set(['not', 'never', 'no', 'without', 'neither', 'nor', 'none', 'nothing', 'nobody', 'nowhere']);
const contractions: Record<string, string> = { cannot: 'can not', cant: 'can not', wont: 'will not', dont: 'do not', doesnt: 'does not', didnt: 'did not', isnt: 'is not', arent: 'are not', wasnt: 'was not', werent: 'were not', hasnt: 'has not', havent: 'have not', hadnt: 'had not', couldnt: 'could not', wouldnt: 'would not', shouldnt: 'should not', mustnt: 'must not' };
interface Parsed { value: number; next: number }

function underHundred(words: readonly string[], at: number): Parsed | undefined {
  const token = words[at] ?? '';
  const unit = small.indexOf(token);
  if (unit >= 0) return { value: unit, next: at + 1 };
  const ten = tens[token];
  if (ten !== undefined) {
    const trailing = small.indexOf(words[at + 1] ?? '');
    return { value: ten + (trailing > 0 && trailing < 10 ? trailing : 0), next: at + (trailing > 0 && trailing < 10 ? 2 : 1) };
  }
  return undefined;
}

function underThousand(words: readonly string[], at: number): Parsed | undefined {
  const leading = small.indexOf(words[at] ?? '');
  let value: number, next: number;
  if (words[at] === 'hundred') { value = 100; next = at + 1; }
  else if (words[at + 1] === 'hundred' && ((leading > 0 && leading < 10) || words[at] === 'a')) { value = (leading > 0 ? leading : 1) * 100; next = at + 2; }
  else return underHundred(words, at);
  const remainderAt = words[next] === 'and' ? next + 1 : next;
  const remainder = underHundred(words, remainderAt);
  if (remainder && remainder.value > 0) { value += remainder.value; next = remainder.next; }
  return { value, next };
}

function englishInteger(words: readonly string[], at: number): Parsed | undefined {
  let head = underThousand(words, at);
  if (words[at] === 'thousand') head = { value: 1, next: at };
  if (words[at] === 'a' && words[at + 1] === 'thousand') head = { value: 1, next: at + 1 };
  if (!head) return undefined;
  if (words[head.next] !== 'thousand' || head.value <= 0) return head;
  let value = head.value * 1000, next = head.next + 1;
  const remainderAt = words[next] === 'and' ? next + 1 : next;
  const remainder = underThousand(words, remainderAt);
  if (remainder && remainder.value > 0) { value += remainder.value; next = remainder.next; }
  return { value, next };
}

/** Bounded cardinals 0–999,999; optional sign and 1–6 spoken decimal digits.
 * Deliberately does not guess year readings, ordinals, fractions, or million/billion.
 */
export function canonicalSpeechTokens(text: string): string[] {
  const cleaned = text.toLowerCase().normalize('NFKC').replace(/[’']/gu, '').replace(/(?<=\p{L})[-‐‑](?=\p{L})/gu, ' ');
  const raw = (cleaned.match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[\p{L}]+|%/gu) ?? [])
    .flatMap(token => (contractions[token] ?? token).split(' '));
  const result: string[] = [];
  for (let at = 0; at < raw.length;) {
    const token = raw[at]!;
    if (token === '%' || token === 'percent' || (token === 'per' && raw[at + 1] === 'cent')) {
      result.push('percent'); at += token === 'per' ? 2 : 1; continue;
    }
    const sign = token === 'minus' || token === 'negative' ? -1 : 1;
    const numberAt = at + Number(sign < 0);
    const numeral = raw[numberAt]?.replaceAll(',', '');
    let parsed: Parsed | undefined;
    if (numeral && /^[+-]?\d+(?:\.\d+)?$/u.test(numeral) && Number.isFinite(Number(numeral))) parsed = { value: Number(numeral), next: numberAt + 1 };
    else parsed = englishInteger(raw, numberAt);
    if (!parsed) { result.push(token); at++; continue; }
    let value = parsed.value;
    if (raw[parsed.next] === 'point' && Number.isInteger(value)) {
      let digits = '', next = parsed.next + 1;
      while (next < raw.length && digits.length < 6) {
        const digit = small.indexOf(raw[next]!);
        if (digit < 0 || digit > 9) break;
        digits += String(digit); next++;
      }
      // Never silently truncate a longer decimal.
      const trailingDigit = small.indexOf(raw[next] ?? '');
      if (digits && !(trailingDigit >= 0 && trailingDigit <= 9)) { value += (value < 0 || Object.is(value, -0) ? -1 : 1) * Number(`0.${digits}`); parsed.next = next; }
    }
    result.push(String(sign * value));
    at = parsed.next;
  }
  return result;
}

export function speechTranscriptWarnings(script: string, transcript: string): string[] {
  const expected = canonicalSpeechTokens(script), actual = canonicalSpeechTokens(transcript);
  const warnings = transcriptWarnings(expected.join(' '), actual.join(' '));
  const significant = (tokens: string[]) => tokens.filter(token => /^-?\d/u.test(token) || negatives.has(token) || token === 'percent');
  if (JSON.stringify(significant(expected)) !== JSON.stringify(significant(actual)) && !warnings.some(warning => warning.includes('number or negation'))) warnings.push('A number, percent unit, or negation differs between the script and transcript. Check the saved audio and transcript.');
  return warnings;
}
