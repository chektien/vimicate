import { GatewayArtifactContext } from '../gateway/GatewayArtifactContext';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { recordGatewayDiagnostic } from '../../modules/vimicate-diagnostics';
import { cachedGatewayImageSource, invalidateGatewayImageSource, type ImageNetworkSource } from './gatewayImageSource';
import { materializedIOSLocalImageSource } from './iosLocalImageSource';
import { mediaScenePublicationAuthority as scene } from './mediaScenePublicationAuthority';

type Phase = 'resolving' | 'loading' | 'decoded' | 'failed';
type Request = { id: number; attachment: WorkspaceAttachment; revision: number | null; disposed: boolean };
type ImageState = { source: ImageNetworkSource; phase: Phase; request: Request | null };
const unresolved: ImageState = { source: { uri: '' }, phase: 'resolving', request: null };

/** One request owns resolution, Files access, native decode and React publication. */
export function useGatewayImage(attachment: WorkspaceAttachment) {
  const resolveArtifact = useContext(GatewayArtifactContext);
  const [state, setState] = useState<ImageState>(unresolved);
  const [retry, setRetry] = useState(0);
  const request = useRef<Request | null>(null);
  const sequence = useRef(0);
  const committedAttachment = useRef(attachment);
  const committed = useRef(state);
  const localAccess = useRef<WorkspaceAttachment | null>(null);
  // Speculative renders cannot retire the request belonging to the visible leaf.
  useLayoutEffect(() => { committed.current = state; committedAttachment.current = attachment; }, [state, attachment]);

  const current = (candidate: Request) => !candidate.disposed && request.current === candidate
    && sameImageInput(candidate.attachment, committedAttachment.current);
  const publishable = (candidate: Request) => current(candidate) && scene.owns(candidate.revision);

  useEffect(() => scene.subscribeResume(() => {
    const pending = request.current;
    if (!pending || !current(pending) || scene.owns(pending.revision)) return;
    const shown = committed.current;
    if (shown.request === pending && (shown.phase === 'decoded' || shown.phase === 'failed')) return;
    // Readmit pending work at resume, not after its retired promise happens to
    // settle. Shared cached byte work may finish; only its old publisher retires.
    pending.disposed = true;
    setRetry(value => value + 1);
  }), []);

  useEffect(() => {
    const pending: Request = { id: ++sequence.current, attachment, revision: scene.capture(), disposed: false };
    request.current = pending;
    const dispose = () => { pending.disposed = true; if (request.current === pending) request.current = null; };
    if (pending.revision === null) return dispose;
    const publish = (source: ImageNetworkSource, phase: Phase) => {
      if (!publishable(pending)) return;
      setState(previous => publishable(pending) ? { source, phase, request: pending } : previous);
    };
    publish({ uri: '' }, 'resolving');
    const promptIfNeeded = localAccess.current !== null && sameImageInput(localAccess.current, attachment);
    localAccess.current = null;
    void cachedGatewayImageSource(attachment, resolveArtifact).then(async gatewaySource => {
      if (!publishable(pending)) return;
      const localSource = gatewaySource.uri.startsWith('data:image/') ? null
        : await materializedIOSLocalImageSource(attachment, promptIfNeeded);
      if (!publishable(pending)) return;
      const source = localSource ?? gatewaySource;
      recordGatewayDiagnostic(`media.${source.diagnostic ?? (source.uri.startsWith('data:image/') ? 'materialized-ok' : source.uri.includes('mediaTicket=') ? 'ticket-fallback' : 'direct-fallback')}`);
      publish(source, source.uri ? 'loading' : 'failed');
    }).catch(() => publish({ uri: '' }, 'failed'));
    return dispose;
  }, [attachment.headers, attachment.uri, attachment.filename, attachment.mimeType, attachment.artifactId, attachment.artifactSessionKey, resolveArtifact, retry]);

  const displayed = state.request && sameImageInput(state.request.attachment, attachment) ? state : unresolved;
  // Capture the rendered request, never a mutable "latest accepted revision".
  const decodedRequest = displayed.request;
  const decode = (phase: 'decoded' | 'failed') => {
    if (!decodedRequest || !publishable(decodedRequest)) return;
    if (phase === 'failed') recordGatewayDiagnostic(`media.decode-failed mime=${decodedRequest.attachment.mimeType}`);
    setState(previous => previous.request === decodedRequest && publishable(decodedRequest) ? { ...previous, phase } : previous);
  };
  const retryImage = () => {
    if (scene.capture() === null) return;
    localAccess.current = attachment;
    invalidateGatewayImageSource(attachment);
    setRetry(value => value + 1);
  };
  return { source: displayed.source, phase: displayed.phase, imageKey: decodedRequest?.id,
    retryImage, onLoad: () => decode('decoded'), onError: () => decode('failed') };
}

function sameImageInput(left: WorkspaceAttachment, right: WorkspaceAttachment) {
  return left.artifactId === right.artifactId && left.artifactSessionKey === right.artifactSessionKey && left.uri === right.uri && left.headers === right.headers
    && left.filename === right.filename && left.mimeType === right.mimeType;
}
