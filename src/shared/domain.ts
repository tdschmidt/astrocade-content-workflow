import { z } from 'zod';
import { gameCandidateSchema } from '../server/games/schema.js';
import { contentAssessmentSchema } from './content.js';

export const formatSchema = z.enum(['highlight', 'recommendation', 'story']);
export type VideoFormat = z.infer<typeof formatSchema>;
export const cutSchema = z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().positive() });
export const eventSchema = cutSchema.extend({ event: z.string(), evidence: z.string(), outcome: z.string() });
export const analysisSchema = z.object({
  usable: z.boolean(), reason: z.string(), mechanic: z.string(),
  visualScore: z.number().min(0).max(5), events: z.array(eventSchema).max(6),
  content: contentAssessmentSchema.optional(),
});
export type FootageAnalysis = z.infer<typeof analysisSchema>;
export const subtitleSchema = cutSchema.extend({ text: z.string() });
export const overlaySchema = subtitleSchema.extend({ position: z.enum(['upper', 'lower']) });
export const hookConceptSchema = z.object({
  angle: contentAssessmentSchema.shape.angle,
  hook: z.string().min(1).max(84), caption: z.string().min(1).max(180),
  evidence: z.string().min(1).max(600), tradeoff: z.string().min(1).max(400),
});
export const scriptSchema = z.object({
  hook: z.string().min(1).max(120), narration: z.string().max(1600),
  caption: z.string().min(1).max(2200), cuts: z.array(cutSchema).min(1).max(8),
  rationale: z.string(),
  overlays: z.array(overlaySchema).max(3).optional(),
  editorial: z.object({
    alternatives: z.array(hookConceptSchema).length(3), selectedIndex: z.number().int().min(0).max(2),
    durationReason: z.string(), review: z.string(),
  }).optional(),
});
export type VideoScript = z.infer<typeof scriptSchema>;
export const researchSchema = z.object({
  id: z.string(), createdAt: z.string(), topic: z.string(), summary: z.string(), terms: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string().url(), content: z.string(), observation: z.enum(['search_excerpt', 'extracted_text']) })),
});
export type ResearchSnapshot = z.infer<typeof researchSchema>;
export const captureSchema = z.object({
  id: z.string(), runId: z.string(), profileId: z.string(), game: gameCandidateSchema,
  path: z.string(), durationSeconds: z.number().positive(), width: z.number(), height: z.number(),
  crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  createdAt: z.string(), analysis: analysisSchema.optional(),
});
export type Capture = z.infer<typeof captureSchema>;
