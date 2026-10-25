import { useCallback, useEffect, useRef, useState } from 'react';
import type { GatewayStatus, OpenClawClient } from './OpenClawClient';
import type { ProviderUsageState } from './providerQuota';
import { useActiveInterval } from '../lifecycle/useActiveInterval';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { GatewayProfile } from './setupCode';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const EMPTY_USAGE: ProviderUsageState = { phase: 'idle', snapshot: null };

export function useProviderUsage(client: OpenClawClient, profile: GatewayProfile | null, status: GatewayStatus, scenePublicationAuthority: { current: HistoryPublicationAuthority }) {
  const authority = providerUsageAuthority(profile);
  const [owned, setOwned] = useState<{ authority: string | null; state: ProviderUsageState }>({ authority, state: EMPTY_USAGE });
  const authorityRef = useRef(authority); authorityRef.current = authority;
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSequence.current += 1; };
  }, []);
  useEffect(() => {
    requestSequence.current += 1;
    setOwned({ authority, state: EMPTY_USAGE });
  }, [authority]);
  const refresh = useCallback(async () => {
    if (!authority || client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return;
    const activityRevision = scenePublicationAuthority.current.capture();
    const sequence = ++requestSequence.current;
    const ownsRequest = () => mounted.current
      && authorityRef.current === authority
      && requestSequence.current === sequence
      && client.status === 'connected'
      && scenePublicationAuthority.current.owns(activityRevision);
    setOwned((current) => current.authority === authority
      ? { authority, state: { ...current.state, phase: 'loading' } }
      : { authority, state: { phase: 'loading', snapshot: null } });
    try {
      const payload = await client.providerUsage();
      if (!ownsRequest()) return;
      setOwned({ authority, state: { phase: 'ready', snapshot: { payload, receivedAt: Date.now() } } });
    } catch {
      if (!ownsRequest()) return;
      setOwned((current) => current.authority === authority
        ? { authority, state: { phase: 'error', snapshot: current.state.snapshot } }
        : { authority, state: { phase: 'error', snapshot: null } });
    }
  }, [authority, client, scenePublicationAuthority]);

  useEffect(() => {
    if (status === 'connected') return;
    requestSequence.current += 1;
    setOwned((current) => current.authority === authority
      ? { authority, state: { phase: 'idle', snapshot: current.state.snapshot } }
      : { authority, state: EMPTY_USAGE });
  }, [authority, status]);
  useActiveInterval(() => void refresh(), REFRESH_INTERVAL_MS, status === 'connected' && Boolean(authority), true, authority);

  return { state: owned.authority === authority ? owned.state : EMPTY_USAGE, refresh };
}

function providerUsageAuthority(profile: GatewayProfile | null) {
  if (!profile) return null;
  return JSON.stringify([profile.endpoint, profile.sessionKey, profile.credentialKind, profile.credential]);
}
