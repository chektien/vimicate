import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProjectFilesPane } from '../projectFiles/ProjectFilesPane';
import { useProjectFilesController } from '../projectFiles/useProjectFilesController';
import type { ProjectFilesPort } from '../projectFiles/projectFilesTypes';

// Synthetic fixture only. No Gateway, project registry, pairing or user data.
const dataBase64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA0MjAgNTk1XSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTUyID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgNDAgNTIwIFRkIChWaW1pY2F0ZSBmaWxlIHByZXZpZXcpIFRqIDAgLTQwIFRkIC9GMSAxNCBUZiAoU3ludGhldGljIFBERiAtIGV4YWN0IGZpbGUsIGlubGluZS4pIFRqIDAgLTMwIFRkIChObyBleHRlcm5hbCBGaWxlcyBmb2xkZXIuKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgL1NpemUgNiA+PgpzdGFydHhyZWYKNTE0CiUlRU9GCg==";
const spreadsheet = { dataBase64: "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", size: 1561, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const metadata = { kind: 'document' as const, mimeType: 'application/pdf', size: 697, mtimeMs: 1 };
export const simulatorPDFFixture = { ...metadata, dataBase64 };
const makePort = (xlsx: boolean): ProjectFilesPort => {
  const file = xlsx ? { ...metadata, ...spreadsheet, name: 'preview.xlsx' } : { ...metadata, dataBase64, name: 'preview.pdf' };
  return {
  listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: [{ ...file, path: file.name }] }),
  readFile: async ({ projectId, path }) => ({ ...file, projectId, path }),
};
};
const pdfPort = makePort(false); const xlsxPort = makePort(true);
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px -apple-system;background:#fff;color:#222;margin:24px}button,input{font:inherit;padding:12px}button{background:#b8bb26;border:0}section{min-height:420px}</style></head><body><h1>Interactive HTML preview</h1><section><p>Complete document, rendered in Vimicate.</p><button onclick="this.textContent='Clicked successfully'">Test interaction</button><p><label>Notes <input aria-label="HTML notes" placeholder="Type here"></label></p><a href="#end">Jump to bottom</a></section><h2 id="end">Bottom of the document</h2></body></html>`;
const htmlPort: ProjectFilesPort = {
  listDirectory: async ({ projectId, path }) => ({ projectId, path, entries: [{ name: 'preview.html', path: 'preview.html', kind: 'text', mimeType: 'text/html', size: new TextEncoder().encode(html).length, mtimeMs: 1 }] }),
  readFile: async ({ projectId, path }) => ({ projectId, path, kind: 'text', mimeType: 'text/html', size: new TextEncoder().encode(html).length, mtimeMs: 1, text: html }),
};
export function SimulatorFilePreviewFixture({ xlsx = false, htmlPreview = false }: { xlsx?: boolean; htmlPreview?: boolean }) {
  const controller = useProjectFilesController({ projectId: 'synthetic-preview', port: htmlPreview ? htmlPort : xlsx ? xlsxPort : pdfPort,
    onStatus: () => undefined, onYank: () => undefined, onHandoff: () => undefined, onClose: () => undefined });
  useEffect(() => { controller.openFilePath(htmlPreview ? 'preview.html' : xlsx ? 'preview.xlsx' : 'preview.pdf'); }, [controller.openFilePath, xlsx, htmlPreview]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#1d2021' }}>
    <View style={{ flex: 1 }}><ProjectFilesPane controller={controller} rootPath="/synthetic" presentation="overlay" width={320} focused
      onRequestFocus={() => undefined} onOpenMedia={() => undefined} /></View>
  </SafeAreaView>;
}
