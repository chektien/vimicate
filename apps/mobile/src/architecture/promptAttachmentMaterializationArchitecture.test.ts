// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const controller = readFileSync(new URL('../prompt/usePromptAttachmentController.ts', import.meta.url), 'utf8');

describe('prompt attachment materialization architecture', () => {
  it('routes every send through the bounded read owner instead of whole-file base64', () => {
    expect(controller).toContain("from 'expo-file-system/legacy'");
    expect(controller).toContain('readAsStringAsync(uri, { encoding: EncodingType.Base64, position: 0, length })');
    expect(controller).not.toContain('.readBytes(');
    expect(controller).toContain('materializePromptAttachmentBatch(selected, openAttachmentReader');
    const batch = readFileSync(new URL('../prompt/promptAttachmentUploadBatch.ts', import.meta.url), 'utf8');
    expect(batch).toContain('await materializePromptAttachment(attachment, openReader, remaining, assertActive)');
    expect(batch).toContain('remaining -= payload.byteCount');
    expect(controller).not.toContain('.base64()');
  });
  it('checks synchronous import ownership before clearing a submitted draft', () => {
    const shell = readFileSync(new URL('../app/AppShell.tsx', import.meta.url), 'utf8');
    const submit = shell.slice(shell.indexOf('const submit = async () =>'), shell.indexOf('const onTranscriptKey ='));
    const gate = submit.indexOf('promptAttachments.isImporting(submissionSessionKey)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(submit.indexOf('setPrompt(clearedForSubmission(currentPrompt))'));
    expect(submit).not.toContain('if (promptAttachments.importing)');
  });
});
