export type AppUpdateNoticeInput = {
  pending: boolean;
  applied?: boolean;
  dismissed: boolean;
  restartHold: 'submission' | 'attachments' | null;
  restarting: boolean;
  restartFailed?: boolean;
  releaseTitle?: string | undefined;
  fixes?: string[] | undefined;
  updateLabel?: string | undefined;
};

export type AppUpdateNoticePresentation =
  | { visible: false }
  | {
      visible: true;
      detail: string;
      restartLabel: string;
      restartEnabled: boolean;
      applied: boolean;
      state: 'applied' | 'ready' | 'blocked' | 'restarting' | 'failed';
      keyword: 'UPDATED' | 'UPDATE READY' | 'UPDATING' | 'UPDATE FAILED';
      releaseTitle?: string | undefined;
      fixes: string[];
      updateLabel?: string | undefined;
    };

export function appUpdateNoticePresentation(input: AppUpdateNoticeInput): AppUpdateNoticePresentation {
  if ((!input.pending && !input.applied) || input.dismissed) return { visible: false };
  const release = {
    releaseTitle: input.releaseTitle,
    fixes: input.fixes ?? [],
    updateLabel: input.updateLabel,
  };
  if (input.applied) {
    return { visible: true, detail: 'installed · ready to use', restartLabel: 'applied', restartEnabled: false, applied: true, state: 'applied', keyword: 'UPDATED', ...release };
  }
  if (input.restarting) {
    return { visible: true, detail: 'restarting with update…', restartLabel: 'restarting', restartEnabled: false, applied: false, state: 'restarting', keyword: 'UPDATING', ...release };
  }
  if (input.restartHold === 'submission') {
    return { visible: true, detail: 'ready · finish sending the prompt first', restartLabel: 'after send', restartEnabled: false, applied: false, state: 'blocked', keyword: 'UPDATE READY', ...release };
  }
  if (input.restartHold === 'attachments') {
    return { visible: true, detail: 'ready · send or remove staged attachments first', restartLabel: 'attachments', restartEnabled: false, applied: false, state: 'blocked', keyword: 'UPDATE READY', ...release };
  }
  if (input.restartFailed) {
    return { visible: true, detail: 'restart failed · update remains ready', restartLabel: 'retry', restartEnabled: true, applied: false, state: 'failed', keyword: 'UPDATE FAILED', ...release };
  }
  return { visible: true, detail: 'downloaded · restart to apply', restartLabel: 'restart', restartEnabled: true, applied: false, state: 'ready', keyword: 'UPDATE READY', ...release };
}
