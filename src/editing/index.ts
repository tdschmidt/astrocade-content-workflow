import type { Capture } from '../shared/domain.js';
import type { ContentBrief } from '../shared/content.js';
import { renderMeme } from './meme.js';
import { editorialResultSchema, verifyEditorInputs, type EditorSettings } from './contracts.js';

export async function editGameplay(options: {
  settings: EditorSettings; capture: Capture; sourceSha256: string; runPath: string; output: string;
  model: string; brief: ContentBrief; captureFeedbackPath?: string; signal?: AbortSignal;
}) {
  const { settings } = options;
  await verifyEditorInputs(settings);
  const common = {
    ...options, feedbackPath: settings.feedback?.path, windowsPath: settings.windows?.path,
  };
  if (settings.format === 'legacy') throw new Error('Legacy edits use the original renderer.');
  const result = settings.format === 'meme'
    ? await renderMeme({ ...common, style: settings.style })
    : await (await import('./narrated.js')).renderNarrated({ ...common, format: settings.format,
      narration: settings.narration, storySourcePath: settings.storySource?.path });
  await verifyEditorInputs(settings);
  return editorialResultSchema.parse(result);
}
