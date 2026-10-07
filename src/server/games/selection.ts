import type { GameMetric } from './schema.js';

/** Only labeled public counters qualify. Bare numbers and category position do not. */
export function parsePublicMetrics(text: string): GameMetric[] {
  const values = new Map<GameMetric['label'], GameMetric>();
  const count = '(\\d[\\d,]*(?:\\.\\d+)?\\s*[kmb]?)';
  const label = '(plays?|players?|likes?|favou?rites?)';
  const patterns = [new RegExp(`${count}\\s+${label}\\b`, 'gi'), new RegExp(`\\b${label}\\s*:\\s*${count}`, 'gi')];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const rawCount = match[index === 0 ? 1 : 2]!.replace(/\s+/g, '');
      const rawLabel = match[index === 0 ? 2 : 1]!.toLowerCase();
      const metricLabel: GameMetric['label'] = rawLabel.startsWith('playe') ? 'players' : rawLabel.startsWith('play') ? 'plays' : rawLabel.startsWith('like') ? 'likes' : 'favorites';
      const suffix = rawCount.at(-1)?.toLowerCase();
      const multiplier = suffix === 'k' ? 1000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
      const value = Number.parseFloat(rawCount.replaceAll(',', '')) * multiplier;
      if (Number.isFinite(value)) values.set(metricLabel, { label: metricLabel, raw: match[0].trim(), value, approximate: multiplier !== 1 });
    }
  }
  return [...values.values()];
}
