import { describe, expect, it } from 'vitest';
import { appUpdateNoticePresentation } from './appUpdateNoticePresentation';

describe('app update notice', () => {
  it('stays hidden until an update is fully downloaded', () => {
    expect(appUpdateNoticePresentation({ pending: false, dismissed: false, restartHold: null, restarting: false })).toEqual({ visible: false });
  });

  it('offers restart for a downloaded update during an active selected run', () => {
    expect(appUpdateNoticePresentation({ pending: true, dismissed: false, restartHold: null, restarting: false })).toEqual({
      visible: true,
      detail: 'downloaded · restart to apply',
      restartLabel: 'restart',
      restartEnabled: true,
      applied: false,
      state: 'ready',
      keyword: 'UPDATE READY',
      releaseTitle: undefined,
      fixes: [],
      updateLabel: undefined,
    });
  });

  it('holds restart only while a prompt is still sending', () => {
    expect(appUpdateNoticePresentation({ pending: true, dismissed: false, restartHold: 'submission', restarting: false })).toMatchObject({
      detail: 'ready · finish sending the prompt first',
      restartLabel: 'after send',
      restartEnabled: false,
      state: 'blocked',
    });
  });

  it('holds restart while staged attachments have no durable draft', () => {
    expect(appUpdateNoticePresentation({ pending: true, dismissed: false, restartHold: 'attachments', restarting: false })).toMatchObject({
      detail: 'ready · send or remove staged attachments first',
      restartEnabled: false,
      state: 'blocked',
    });
  });

  it('honours Later and reports a restart already underway', () => {
    expect(appUpdateNoticePresentation({ pending: true, dismissed: true, restartHold: null, restarting: false })).toEqual({ visible: false });
    expect(appUpdateNoticePresentation({ pending: true, dismissed: false, restartHold: null, restarting: true })).toEqual({
      visible: true,
      detail: 'restarting with update…',
      restartLabel: 'restarting',
      restartEnabled: false,
      applied: false,
      state: 'restarting',
      keyword: 'UPDATING',
      releaseTitle: undefined,
      fixes: [],
      updateLabel: undefined,
    });
  });

  it('carries the downloaded release notes into the visible notice', () => {
    expect(appUpdateNoticePresentation({
      pending: true,
      dismissed: false,
      restartHold: null,
      restarting: false,
      releaseTitle: 'Transcript stability',
      fixes: ['Stops live render-loop crashes', 'Keeps the latest row visible'],
      updateLabel: '1234abcd',
    })).toMatchObject({
      visible: true,
      releaseTitle: 'Transcript stability',
      fixes: ['Stops live render-loop crashes', 'Keeps the latest row visible'],
      updateLabel: '1234abcd',
    });
  });

  it('shows the applied release notes once after the in-app restart', () => {
    expect(appUpdateNoticePresentation({
      pending: false,
      applied: true,
      dismissed: false,
      restartHold: null,
      restarting: false,
      releaseTitle: 'Transcript stability',
      fixes: ['Stops live render-loop crashes'],
    })).toMatchObject({
      visible: true,
      applied: true,
      state: 'applied',
      keyword: 'UPDATED',
      detail: 'installed · ready to use',
      releaseTitle: 'Transcript stability',
      fixes: ['Stops live render-loop crashes'],
    });
  });

  it('gives a failed reload an unambiguous sticky state', () => {
    expect(appUpdateNoticePresentation({
      pending: true,
      dismissed: false,
      restartHold: null,
      restarting: false,
      restartFailed: true,
    })).toMatchObject({
      visible: true,
      state: 'failed',
      keyword: 'UPDATE FAILED',
      restartLabel: 'retry',
      restartEnabled: true,
    });
  });
});
