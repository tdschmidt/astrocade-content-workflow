import { z } from 'zod';
import { gameCandidateSchema, gameProfileSchema, selectionModeSchema } from '../server/games/schema.js';
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
  hook: z.string().min(1).max(60), caption: z.string().min(1).max(180),
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
export const runOptionsSchema = z.object({
  mode: selectionModeSchema.default('balanced'),
  formats: z.array(formatSchema).min(1).max(3).default(['highlight']),
  comparison: z.enum(['best-fit', 'same-game']).default('same-game'),
  profileIds: z.array(z.string()).max(6).default([]),
  topic: z.string().max(500).default(''),
});
export type RunOptions = z.infer<typeof runOptionsSchema>;
export const runSchema = z.object({
  id: z.string(), createdAt: z.string(), options: runOptionsSchema,
  status: z.enum(['pending', 'capturing', 'generating', 'ready', 'needs_attention', 'failed']),
  captureIds: z.array(z.string()), draftIds: z.array(z.string()), message: z.string().optional(),
});
export type ContentRun = z.infer<typeof runSchema>;
export const captureSchema = z.object({
  id: z.string(), runId: z.string(), profileId: z.string(), game: gameCandidateSchema,
  path: z.string(), durationSeconds: z.number().positive(), width: z.number(), height: z.number(),
  crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  createdAt: z.string(), analysis: analysisSchema.optional(),
});
export type Capture = z.infer<typeof captureSchema>;
export const approvalSchema = z.object({
  draftId: z.string(), revision: z.number().int().positive(), accountUsername: z.string(),
  assetSha256: z.string(), caption: z.string(), requiresAiDisclosure: z.boolean(), approvedAt: z.string(),
});
export const outcomeSchema = z.object({
  status: z.enum(['ready', 'needs_attention', 'unknown']), stage: z.string(),
  username: z.string().optional(), reason: z.string().optional(), attemptId: z.string().optional(), permalink: z.string().optional(),
});
export const publicationSchema = z.object({
  draftId: z.string(), revision: z.number(),
  intent: approvalSchema.extend({ attemptId: z.string(), attemptedAt: z.string(), previousPermalinks: z.array(z.string()) }).optional(),
  result: outcomeSchema.optional(),
});
export const draftSchema = scriptSchema.extend({
  id: z.string(), runId: z.string(), revision: z.number().int().positive(), captureId: z.string(),
  createdAt: z.string(), format: formatSchema,
  status: z.enum(['planned', 'rendering', 'ready', 'needs_attention', 'failed']),
  videoPath: z.string().optional(), audioPath: z.string().optional(), assetSha256: z.string().optional(),
  subtitles: z.array(subtitleSchema).default([]), warnings: z.array(z.string()).default([]),
  shorteningAttempts: z.number().int().nonnegative().default(0),
  approval: approvalSchema.optional(),
});
export type Draft = z.infer<typeof draftSchema>;
export const workspaceSchema = z.object({
  version: z.literal(1), candidates: z.array(gameCandidateSchema), profiles: z.array(gameProfileSchema),
  discovery: z.object({ observedAt: z.string(), status: z.string(), sources: z.array(z.object({ url: z.string(), observedAt: z.string(), status: z.string(), candidateCount: z.number(), message: z.string().optional() })) }).optional(),
  research: z.array(researchSchema), captures: z.array(captureSchema), runs: z.array(runSchema), drafts: z.array(draftSchema),
  signup: z.object({
    checkpoint: z.object({ phase: z.enum(['submitted', 'verification_submitted', 'created']), username: z.string(), verificationRequestedAt: z.string(), usedMessageIds: z.array(z.string()).optional() }).optional(),
    outcome: outcomeSchema.optional(),
  }),
  publications: z.array(publicationSchema),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const emptyWorkspace: Workspace = { version: 1, candidates: [], profiles: [], research: [], captures: [], runs: [], drafts: [], signup: {}, publications: [] };
