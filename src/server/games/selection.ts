import type { GameCandidate, GameMetric, SelectionMode } from './schema.js';

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

export type VisualAssessment = { score: number; reason: string; evidence: string };
export type RankedGame = {
  candidate: GameCandidate;
  reasons: string[];
  signals: { popularity?: GameMetric; visual?: VisualAssessment; trendMatches: string[] };
  provisional: boolean;
};

export function rankGames(candidates: GameCandidate[], options: {
  mode: SelectionMode;
  trendTerms?: string[];
  visualAssessments?: Record<string, VisualAssessment>;
}): RankedGame[] {
  // Choose one comparable public metric; never compare a play count with likes.
  const labels: GameMetric['label'][] = ['plays', 'players', 'likes', 'favorites'];
  const metricLabel = labels.toSorted((a, b) =>
    candidates.filter(c => c.metrics.some(m => m.label === b)).length - candidates.filter(c => c.metrics.some(m => m.label === a)).length,
  )[0]!;
  const terms = [...new Set((options.trendTerms ?? []).map(t => t.trim().toLocaleLowerCase()).filter(Boolean))];
  const ranked = candidates.map(candidate => {
    const popularity = candidate.metrics.find(m => m.label === metricLabel);
    const proposedVisual = options.visualAssessments?.[candidate.id];
    const visual = proposedVisual && Number.isFinite(proposedVisual.score) && proposedVisual.score >= 0 && proposedVisual.score <= 5 && proposedVisual.evidence.trim()
      ? proposedVisual : undefined;
    const text = `${candidate.title}\n${candidate.observations.map(o => o.cardText).join('\n')}`.toLocaleLowerCase();
    const trendMatches = terms.filter(term => text.includes(term));
    const reasons = [popularity ? `Observed ${popularity.raw}; source-linked cumulative counter, not growth.` : 'No comparable public popularity counter observed.'];
    if (visual) reasons.push(`${visual.reason} Evidence: ${visual.evidence}`);
    else reasons.push('Visual appeal and useful gameplay still require an actual play probe.');
    if (trendMatches.length) reasons.push(`Matches saved research terms: ${trendMatches.join(', ')}. This is a textual fit, not proof of a current trend.`);
    return { candidate, reasons, signals: { popularity, visual, trendMatches }, provisional: !visual } satisfies RankedGame;
  });
  // No-match is an honest result in trend mode, rather than a silent evergreen fallback.
  const eligible = options.mode === 'trend' ? ranked.filter(r => r.signals.trendMatches.length) : ranked;
  const maximum = Math.max(1, ...eligible.map(r => r.signals.popularity?.value ?? 0));
  const score = (item: RankedGame) => {
    const pop = item.signals.popularity ? Math.log1p(item.signals.popularity.value) / Math.log1p(maximum) : undefined;
    const vis = item.signals.visual ? item.signals.visual.score / 5 : undefined;
    const trend = item.signals.trendMatches.length ? Math.min(1, item.signals.trendMatches.length / Math.max(1, terms.length)) : undefined;
    if (options.mode === 'popular') return pop ?? -1;
    if (options.mode === 'visual') return vis ?? -1;
    if (options.mode === 'trend') return trend ?? -1;
    const known = [[pop, 0.3], [vis, 0.4], [trend, 0.3]].filter(([value]) => value !== undefined) as [number, number][];
    return known.length ? known.reduce((sum, [value, weight]) => sum + value * weight, 0) / known.reduce((sum, [, weight]) => sum + weight, 0) : -1;
  };
  return eligible.toSorted((a, b) => score(b) - score(a));
}
