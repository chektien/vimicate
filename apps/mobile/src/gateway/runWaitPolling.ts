import type { AgentWaitResult } from './OpenClawClient';
import { isRunWaitRequestTimeout, isRunWaitTimeout } from './runLifecycle';

type RunWaitPollingOptions = {
  wait: () => Promise<AgentWaitResult>;
  isConnected: () => boolean;
  ownsRun: () => boolean;
  onWaiting: (result?: AgentWaitResult) => void;
};

/**
 * `agent.wait` has two distinct timeout boundaries. A successful response
 * whose status is `timeout` means the run is still active. The client request
 * can also expire before that response arrives while the socket remains
 * healthy. Both cases must keep one monitor polling the same run; otherwise
 * Stop remains owned but completion is never observed until a reconnect.
 */
export async function waitForAuthoritativeRun(options: RunWaitPollingOptions) {
  for (;;) {
    try {
      const result = await options.wait();
      if (!isRunWaitTimeout(result) || !options.isConnected() || !options.ownsRun()) return result;
      options.onWaiting(result);
    } catch (error) {
      if (!isRunWaitRequestTimeout(error) || !options.isConnected() || !options.ownsRun()) throw error;
      options.onWaiting();
    }
  }
}
