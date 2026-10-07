import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const inputArtifact = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) });
export const editorSettingsSchema = z.object({
  format: z.enum(['legacy', 'meme', 'overview', 'story']),
  style: z.enum(['auto', 'troll-freeze', 'ironic-fail', 'velocity']).default('auto'),
  narration: z.enum(['local', 'gemini']).default('local'),
  windows: inputArtifact.optional(), feedback: inputArtifact.optional(), storySource: inputArtifact.optional(),
});
export type EditorSettings = z.infer<typeof editorSettingsSchema>;
export interface EditorRequest {
  format: EditorSettings['format']; style?: EditorSettings['style']; narration?: EditorSettings['narration'];
  windowsPath?: string; feedbackPath?: string; storySourcePath?: string;
}
export const editorialResultSchema = z.object({
  videoPath: z.string(), videoSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  planPath: z.string(), caption: z.string(), durationSeconds: z.number().positive(),
});
export type EditorialResult = z.infer<typeof editorialResultSchema>;

async function snapshot(path: string) {
  const absolute = resolve(path);
  return { path: absolute, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') };
}
export async function prepareEditor(request: EditorRequest): Promise<EditorSettings> {
  const settings = editorSettingsSchema.parse({
    format: request.format, style: request.style, narration: request.narration,
    windows: request.windowsPath ? await snapshot(request.windowsPath) : undefined,
    feedback: request.feedbackPath ? await snapshot(request.feedbackPath) : undefined,
    storySource: request.storySourcePath ? await snapshot(request.storySourcePath) : undefined,
  });
  if (settings.format === 'story' && !settings.storySource) throw new Error('Story editing needs --story-source with a grounded story fact ledger.');
  if (settings.format !== 'story' && settings.storySource) throw new Error('--story-source is only used by the story format.');
  if (settings.format !== 'meme' && settings.style !== 'auto') throw new Error('--style only applies to meme editing.');
  if (settings.format === 'legacy' && (settings.windows || settings.feedback)) throw new Error('Use the integrated editors for source windows and edit feedback.');
  return settings;
}
export async function verifyEditorInputs(settings: EditorSettings) {
  for (const input of [settings.windows, settings.feedback, settings.storySource]) {
    if (input && (await snapshot(input.path)).sha256 !== input.sha256) throw new Error('A saved editorial input changed. Start a new --from-run revision.');
  }
}
