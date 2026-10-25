import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const MANAGED_MEDIA_PREFIXES = ['/api/chat/media/outgoing/', '/__openclaw__/assistant-media'];

export function decorateGatewayMedia(
  messages: WorkspaceMessage[],
  endpoint: string,
  credential: string,
  sessionKey: string,
) {
  const origin = gatewayHttpOrigin(endpoint);
  if (!origin) return messages;
  return messages.map((message) => ({
    ...message,
    ...(message.attachments?.length ? {
      attachments: message.attachments.map((attachment) => {
        const source = normalizedManagedSource(attachment.uri?.trim() ?? '', origin);
        if (!isManagedGatewaySource(source)) return attachment;
        return {
          ...attachment,
          uri: `${origin}${source}`,
          ...(attachment.artifactId ? { artifactSessionKey: managedArtifactSessionKey(source) || sessionKey } : {}),
          ...(credential ? {
            headers: {
              Authorization: `Bearer ${credential}`,
              'x-openclaw-requester-session-key': sessionKey,
            },
          } : {}),
        };
      }),
    } : {}),
  }));
}

function normalizedManagedSource(source: string, gatewayOrigin: string) {
  if (/^https?:\/\//i.test(source)) {
    try {
      const absolute = new URL(source);
      if (absolute.origin !== gatewayOrigin) return source;
      const sameGatewaySource = `${absolute.pathname}${absolute.search}`;
      return isManagedGatewaySource(sameGatewaySource) ? sameGatewaySource : source;
    } catch { return source; }
  }
  if (/^media:\/\/outgoing\//i.test(source)) return `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`;
  if (/^file:\/\//i.test(source)) {
    try { return `/__openclaw__/assistant-media?source=${encodeURIComponent(decodeURIComponent(new URL(source).pathname))}`; }
    catch { return `/__openclaw__/assistant-media?source=${encodeURIComponent(source.replace(/^file:\/\//i, ''))}`; }
  }
  if (source.startsWith('/') && !isManagedGatewaySource(source)) return `/__openclaw__/assistant-media?source=${encodeURIComponent(source)}`;
  return source;
}

function isManagedGatewaySource(source: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return false;
  const path = source.split('?')[0] ?? '';
  return MANAGED_MEDIA_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.endsWith('/__openclaw__/assistant-media');
}

function gatewayHttpOrigin(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return '';
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = '/'; parsed.search = ''; parsed.hash = '';
    return parsed.origin;
  } catch { return ''; }
}

function managedArtifactSessionKey(source: string) {
  const match = source.split('?')[0]?.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\//);
  try { return match?.[1] ? decodeURIComponent(match[1]) : ''; } catch { return ''; }
}
