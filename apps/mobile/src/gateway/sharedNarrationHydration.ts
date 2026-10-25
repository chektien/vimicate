import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { Dispatch, SetStateAction } from 'react';
import { loadSharedNarration, sameSharedNarrationIdentity, type SharedNarrationState, type SharedNarrationTransport } from './sharedNarration';

type HydrationFlight = {
  controller: AbortController;
  result: Promise<WorkspaceMessage[] | null>;
  started: boolean;
  trailing?: Promise<WorkspaceMessage[] | null>;
};

/** One generation-scoped flight, one trailing read and one validated supplement. Retiring
 * stops pagination/retries after an outstanding RPC, without cancelling a
 * different caller's publication authority or accepting partial snapshots. */
export class SharedNarrationHydration {
  private state: SharedNarrationState | null = null;
  private cached: WorkspaceMessage[] = [];
  private flight: HydrationFlight | null = null;
  private warning: { detail: string } | null = null;

  configure(state: SharedNarrationState | null) {
    if (sameSharedNarrationIdentity(this.state, state)) return;
    this.retire();
    this.state = state;
    this.cached = [];
  }

  retire() {
    this.flight?.controller.abort();
    this.flight = null;
  }

  cache(state: SharedNarrationState | null) {
    return sameSharedNarrationIdentity(this.state, state) ? this.cached : [];
  }

  async hydrate(transport: SharedNarrationTransport, state: SharedNarrationState, isCurrent: () => boolean, onDetail: Dispatch<SetStateAction<string>>) {
    const owns = () => isCurrent() && sameSharedNarrationIdentity(this.state, state);
    try {
      const messages = await this.load(transport, state);
      if (!messages || !owns()) return null;
      const warning = this.warning;
      if (warning) onDetail(current => owns() && this.warning === warning && current === warning.detail ? '' : current);
      return messages;
    } catch (error) {
      if (!owns()) return null;
      const warning = { detail: error instanceof Error ? `shared narration unavailable: ${error.message}` : 'shared narration unavailable' };
      this.warning = warning;
      onDetail(current => owns() && this.warning === warning ? warning.detail : current);
      return this.cache(state);
    }
  }

  private load(transport: SharedNarrationTransport, state: SharedNarrationState): Promise<WorkspaceMessage[] | null> {
    if (!sameSharedNarrationIdentity(this.state, state)) return Promise.resolve(null);
    const active = this.flight;
    if (active) {
      if (!active.started) return active.result;
      // A caller arriving after snapshot admission needs a newer read. All
      // callers during this flight share one trailing read, even if it fails.
      return active.trailing ??= active.result.catch(() => null).then(() => {
        if (active.controller.signal.aborted) return null;
        this.flight = null;
        return this.load(transport, state);
      });
    }
    const controller = new AbortController();
    const flight: HydrationFlight = { controller, started: false, result: Promise.resolve(null) };
    // Batch same-turn callers before admitting the snapshot, not after it.
    const result = Promise.resolve().then(() => {
      flight.started = true;
      return loadSharedNarration(transport, state, controller.signal);
    }).then(messages => {
      if (controller.signal.aborted || !sameSharedNarrationIdentity(this.state, state)) return null;
      this.cached = messages;
      return messages;
    }).catch(error => {
      if (controller.signal.aborted) return null;
      throw error;
    }).finally(() => {
      // Keep the active controller owned until its queued successor starts,
      // so retirement also cancels that promise-continuation interval.
      if (this.flight === flight && !flight.trailing) this.flight = null;
    });
    flight.result = result;
    this.flight = flight;
    return result;
  }
}
