import { z } from 'zod';

export const selectionModeSchema = z.enum(['balanced', 'popular', 'visual', 'trend']);
export type SelectionMode = z.infer<typeof selectionModeSchema>;

export const metricSchema = z.object({
  label: z.enum(['plays', 'players', 'likes', 'favorites']),
  raw: z.string(),
  value: z.number().finite().nonnegative(),
  approximate: z.boolean(),
});
export type GameMetric = z.infer<typeof metricSchema>;

export const gameCandidateSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  titleSource: z.enum(['visible_text', 'image_alt', 'url_slug']),
  creator: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  metrics: z.array(metricSchema),
  observations: z.array(z.object({
    sourceUrl: z.string().url(),
    observedAt: z.string(),
    cardText: z.string(),
  })),
});
export type GameCandidate = z.infer<typeof gameCandidateSchema>;

const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const pointerButtonSchema = z.enum(['left', 'right']).optional();
export const keySchema = z.string().regex(/^(Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Key[A-Z]|Digit[0-9])$/);

export const inputActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('key'), key: keySchema, durationMs: z.number().int().min(20).max(2000) }),
  z.object({ type: z.literal('tap'), point: pointSchema, button: pointerButtonSchema }),
  z.object({ type: z.literal('drag'), from: pointSchema, to: pointSchema, durationMs: z.number().int().min(50).max(2000), button: pointerButtonSchema }),
  z.object({ type: z.literal('path'), points: z.array(pointSchema).min(2).max(32), durationMs: z.number().int().min(50).max(2000), button: pointerButtonSchema }),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().min(20).max(5000) }),
]);
export type InputAction = z.infer<typeof inputActionSchema>;

// Persisted actions may omit button (legacy left-click). New model plans must
// choose it explicitly: strict Structured Outputs requires every property.
export const plannedInputActionSchema = z.discriminatedUnion('type', [
  inputActionSchema.options[0].strict(),
  inputActionSchema.options[1].required({ button: true }).strict(),
  inputActionSchema.options[2].required({ button: true }).strict(),
  inputActionSchema.options[3].required({ button: true }).strict(),
  inputActionSchema.options[4].strict(),
]);

export const surfaceLocatorSchema = z.object({
  selector: z.string().min(1).max(500),
  frames: z.array(z.string().min(1).max(500)).max(5).default([]),
});
export type SurfaceLocator = z.infer<typeof surfaceLocatorSchema>;

const uiStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), target: surfaceLocatorSchema }),
  z.object({ type: z.literal('waitFor'), target: surfaceLocatorSchema }),
  ...inputActionSchema.options,
]);
export type UiStep = z.infer<typeof uiStepSchema>;

export const gameProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  name: z.string().min(1).max(150),
  gameUrl: z.string().url(),
  verification: z.enum(['unverified', 'verified']).default('unverified'),
  verificationNotes: z.string().max(2000).optional(),
  viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(320).max(1920) }),
  surface: surfaceLocatorSchema,
  ready: surfaceLocatorSchema,
  setup: z.array(uiStepSchema).max(20).default([]),
  start: z.array(uiStepSchema).max(20).default([]),
  reset: z.array(uiStepSchema).max(20).default([]),
  focus: z.enum(['click', 'focus']).default('click'),
  objective: z.string().min(1).max(1000),
  maxDurationMs: z.number().int().min(1000).max(175000).default(60000),
  controller: z.discriminatedUnion('type', [
    z.object({ type: z.literal('timed'), actions: z.array(inputActionSchema).min(1).max(60), repetitions: z.number().int().min(1).max(20).default(1) }),
    z.object({
      type: z.literal('sparse'), maxDecisions: z.number().int().min(1).max(20).default(6),
      instructions: z.string().max(3000).default(''),
      allowedKeys: z.array(keySchema).max(20).default([]),
      allowPointer: z.boolean().default(false),
    }),
  ]),
});
export type GameProfile = z.infer<typeof gameProfileSchema>;

export const controlDecisionSchema = z.object({
  stop: z.boolean(),
  reason: z.string().max(1000),
  actions: z.array(inputActionSchema).max(8),
});
export type ControlDecision = z.infer<typeof controlDecisionSchema>;
