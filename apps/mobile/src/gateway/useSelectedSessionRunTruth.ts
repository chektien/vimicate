import { useCallback, useEffect, useRef } from 'react';
import type { OpenClawClient } from './OpenClawClient';
import { refreshSelectedSessionRunTruth } from './sessionRegistryLifecycle';
import type { SessionRunRegistry } from './sessionRunRegistry';
import type { HistoryPublicationAuthority } from './historyPublicationAuthority';

type RegistryRef = { current: SessionRunRegistry };
type Request = { key: string; follow: boolean; ownsGeneration: () => boolean };
type Ticket = {
  activity: number;
  connection: number;
  pending: Request | null;
  promise: Promise<void>;
};

export function useSelectedSessionRunTruth(
  client: OpenClawClient,
  registry: RegistryRef,
  persistRuns: () => void,
  publishSelectedRun: (sessionKey?: string) => void,
  scenePublicationAuthority: { current: HistoryPublicationAuthority },
) {
  const owner = useRef<Ticket | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; owner.current = null; };
  }, [client]);

  return useCallback((sessionKey: string, followSession = false, ownsGeneration: () => boolean = () => true): Promise<void> => {
    if (!mounted.current || !sessionKey || client.status !== 'connected' || !scenePublicationAuthority.current.isActive) return Promise.resolve();
    const activity = scenePublicationAuthority.current.capture();
    const connection = client.connectionRevision;
    const pending: Request = { key: sessionKey, follow: followSession, ownsGeneration };
    const current = owner.current;
    if (current && current.activity === activity && current.connection === connection) {
      // A census requiring a subscription must not lose that requirement when
      // a newer selection replaces its not-yet-started read.
      pending.follow ||= current.pending?.follow === true;
      current.pending = pending;
      return current.promise;
    }
    const ticket: Ticket = { activity, connection, pending, promise: Promise.resolve() };
    owner.current = ticket;
    // One wire read plus one replaceable latest intent. Never queue every
    // visited project or publish a superseded run-state observation.
    ticket.promise = Promise.resolve().then(async () => {
      try {
        while (owner.current === ticket && ticket.pending) {
          const request = ticket.pending;
          ticket.pending = null;
          const owns = () => mounted.current && owner.current === ticket && ticket.pending === null
            && scenePublicationAuthority.current.owns(activity) && client.status === 'connected'
            && client.connectionRevision === connection && request.ownsGeneration();
          if (!owns()) continue;
          try {
            if (request.follow) await client.followSession(request.key);
            if (!owns()) continue;
            const changed = await refreshSelectedSessionRunTruth(client, registry.current, request.key, owns);
            if (owns() && changed) { persistRuns(); publishSelectedRun(request.key); }
          } catch (error) {
            if (owns()) throw error;
          }
        }
      } finally {
        if (owner.current === ticket) owner.current = null;
      }
    });
    return ticket.promise;
  }, [client, persistRuns, publishSelectedRun, registry, scenePublicationAuthority]);
}
