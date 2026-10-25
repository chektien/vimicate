import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';

function imageSource(text: string) {
  const [message] = messagesFromPayload({ messages: [{ id: 'answer', role: 'assistant', text }] });
  const uri = message?.attachments?.[0]?.uri ?? '';
  return uri.startsWith('/__openclaw__/assistant-media?')
    ? new URL(uri, 'https://gateway.invalid').searchParams.get('source') : uri;
}

describe('Markdown image destination decoding', () => {
  it('decodes an iCloud Markdown path before wrapping it in a Gateway query', () => {
    expect(imageSource('![phone](/Users/example/Library/Mobile%20Documents/com~apple~CloudDocs/notes/390-up-to-date.png)'))
      .toBe('/Users/example/Library/Mobile Documents/com~apple~CloudDocs/notes/390-up-to-date.png');
  });
  it('decodes local Markdown destinations exactly once, including unicode and literal percent escapes', () => {
    expect(imageSource('![proof](~/notes/%E5%9B%BE%20%2520.png)')).toBe('~/notes/图 %20.png');
    expect(imageSource('![proof](<artifacts/my%20image.png>)')).toBe('artifacts/my image.png');
  });
  it('leaves raw structured paths and MEDIA directives literal', () => {
    expect(imageSource('MEDIA:/notes/literal%20name.png')).toBe('/notes/literal%20name.png');
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: [{ type: 'image', path: '/notes/literal%20name.png' }] }] });
    expect(new URL(message!.attachments![0]!.uri!, 'https://gateway.invalid').searchParams.get('source')).toBe('/notes/literal%20name.png');
  });
  it('preserves remote URL escaping and existing file URL decoding', () => {
    expect(imageSource('![proof](https://cdn.example/my%20image.png?key=a%2520b)')).toBe('https://cdn.example/my%20image.png?key=a%2520b');
    expect(imageSource('![proof](file:///notes/literal%2520name.png)')).toBe('/notes/literal%20name.png');
  });
  it('keeps malformed percent text usable without throwing', () => {
    expect(imageSource('![proof](/notes/100%proof.png)')).toBe('/notes/100%proof.png');
  });
});
