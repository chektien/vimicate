import { describe, expect, it, vi } from 'vitest';
import { dispatchGatewayEventSafely } from './gatewayEventDispatch';

describe('Gateway event dispatch boundary', () => {
  it('contains a synchronous live-projection exception and reports it once', () => {
    const failure = vi.fn();
    expect(dispatchGatewayEventSafely({ event: 'agent' }, () => { throw new Error('projection failed'); }, failure)).toBe(false);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'projection failed' }));
  });

  it('keeps ordinary event delivery unchanged', () => {
    const publish = vi.fn();
    expect(dispatchGatewayEventSafely({ event: 'chat' }, publish, vi.fn())).toBe(true);
    expect(publish).toHaveBeenCalledWith({ event: 'chat' });
  });
});
