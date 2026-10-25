export type GatewayFrame = Record<string, unknown>;

export type GatewayRefreshIntent = {
  detail: string;
  refreshSessions: boolean;
  refreshRegistry: boolean;
  refreshHistory: boolean;
  refreshDuringRun?: boolean;
};

/**
 * Return only explicit Gateway session authority. Never infer event ownership
 * from the currently selected project.
 */
export function gatewayFrameSessionKey(frame: GatewayFrame) {
  const payload = recordValue(frame.payload);
  const request = recordValue(payload.request);
  return stringValue(payload.sessionKey) || stringValue(request.sessionKey) || stringValue(payload.key);
}

export function refreshIntentForGatewayEvent(frame: GatewayFrame, selectedSessionKey: string): GatewayRefreshIntent {
  const event = stringValue(frame.event) || stringValue(frame.type) || 'event';
  const payload = recordValue(frame.payload);
  const eventSessionKey = gatewayFrameSessionKey(frame);
  const concernsSelectedSession = Boolean(eventSessionKey && eventSessionKey === selectedSessionKey);

  if (event === 'session.message') {
    return { detail: concernsSelectedSession ? event : '', refreshSessions: false, refreshRegistry: false, refreshHistory: concernsSelectedSession,
      ...(concernsSelectedSession && (recordValue(payload.message).role === 'user' || recordValue(recordValue(payload.message).openclawAsyncDelivery).itemId) ? { refreshDuringRun: true } : {}) };
  }

  if (event === 'sessions.changed') {
    const phase = stringValue(payload.phase);
    const messageOnly = phase === 'message' && concernsSelectedSession;
    return {
      detail: concernsSelectedSession || !eventSessionKey ? (phase ? `${event}:${phase}` : event) : '',
      refreshSessions: !messageOnly,
      refreshRegistry: !messageOnly,
      refreshHistory: concernsSelectedSession,
    };
  }

  if (event === 'chat') {
    const state = stringValue(payload.state);
    return { detail: concernsSelectedSession ? (state ? `chat:${state}` : event) : '', refreshSessions: false, refreshRegistry: false, refreshHistory: concernsSelectedSession && state !== 'delta' };
  }

  if (event === 'agent') {
    const stream = stringValue(payload.stream);
    const data = recordValue(payload.data);
    const phase = stringValue(data.phase);
    const terminalLifecycle = (stream === 'lifecycle' || stream === 'fallback')
      && ['end', 'error', 'failed', 'complete', 'completed'].includes(phase);
    return {
      detail: concernsSelectedSession ? (stream ? `agent:${stream}` : event) : '',
      refreshSessions: concernsSelectedSession && terminalLifecycle,
      refreshRegistry: concernsSelectedSession && terminalLifecycle,
      refreshHistory: concernsSelectedSession && terminalLifecycle,
    };
  }

  if (/(?:chat|agent|run|message)/i.test(event)) {
    return { detail: concernsSelectedSession ? event : '', refreshSessions: false, refreshRegistry: false, refreshHistory: concernsSelectedSession };
  }

  return { detail: eventSessionKey ? concernsSelectedSession ? event : '' : event, refreshSessions: false, refreshRegistry: false, refreshHistory: false };
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}
