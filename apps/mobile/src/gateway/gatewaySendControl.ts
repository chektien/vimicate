export type GatewaySendControl =
  | { queueMode: 'steer'; steerPolicy: 'require-active'; expectedActiveRunId: string }
  | { queueMode: 'interrupt'; expectedActiveRunId: string }
  | { queueMode: 'followup'; sessionId: string };

/** An explicit control request must name the run the person saw. Never fall
 * back to an unfenced session-wide cancellation. Followup is a separate user
 * turn, not steering and not authority to interrupt the current owner. */
export function gatewaySendControlFields(control?: 'steer' | GatewaySendControl) {
  if (!control) return {};
  if (control === 'steer') return { queueMode: control }; // Native async-answer delivery.
  if (control.queueMode === 'followup') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(control.sessionId)) throw new Error('Refresh this thread before queueing its next turn.');
    return { queueMode: 'followup', sessionId: control.sessionId };
  }
  if (!control.expectedActiveRunId.trim()) throw new Error('Refresh this thread before controlling its active run.');
  return control.queueMode === 'interrupt'
    ? { queueMode: 'interrupt', expectedActiveRunId: control.expectedActiveRunId }
    : { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: control.expectedActiveRunId };
}

export function activeRunSendControl(runId: string, interrupt: boolean): GatewaySendControl {
  return interrupt ? { queueMode: 'interrupt', expectedActiveRunId: runId }
    : { queueMode: 'steer', steerPolicy: 'require-active', expectedActiveRunId: runId };
}
