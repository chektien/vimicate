export type GatewayArtifactResolver = (artifactId: string, sessionKey: string, signal: AbortSignal) => Promise<{ uri: string }>;

/** Validate the scoped artifact response before handing its capability to the image loader. */
export function gatewayArtifactDownloadSource(payload: unknown, endpoint: string, artifactId: string, sessionKey: string) {
  if (!record(payload) || !record(payload.artifact) || payload.artifact.id !== artifactId
    || payload.artifact.sessionKey !== sessionKey || payload.artifact.type !== 'image'
    || !record(payload.artifact.download) || payload.artifact.download.mode !== 'url'
    || typeof payload.url !== 'string') throw new Error('Invalid image artifact response');
  const gateway = new URL(endpoint);
  gateway.protocol = gateway.protocol === 'wss:' ? 'https:' : gateway.protocol === 'ws:' ? 'http:' : gateway.protocol;
  if (!['https:', 'http:'].includes(gateway.protocol)) throw new Error('Invalid artifact endpoint');
  const uri = new URL(payload.url, gateway.origin);
  if (uri.origin !== gateway.origin || uri.username || uri.password
    || !uri.pathname.startsWith(`/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/`) || !uri.searchParams.get('mediaTicket')) {
    throw new Error('Invalid image artifact capability');
  }
  return { uri: uri.toString() };
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
