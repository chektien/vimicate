import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { appendPromptHistory, loadDraft, loadPromptHistory, saveDraft } from '../storage/workspaceStore';
import { createPromptState, type PromptState } from './vimPromptCore';
import { draftHydrationDecision, SessionPromptDraftMemory } from './draftHydration';
import { mergedRejectedDraft, restoredAfterRejectedSubmission, submissionResultOwnsSelectedPrompt } from './submissionDraft';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';
import { acceptedPromptHistorySelection, closePromptHistoryBrowser, closedPromptHistoryBrowser, movePromptHistoryBrowser, openPromptHistoryBrowser, promptHistoryBrowserAction, promptHistorySelection, type PromptHistoryBrowserState } from './promptHistoryBrowser';

export function usePromptHistoryController(sessionKey: string, prompt: PromptState, promptRef: { current: PromptState }, setPrompt: Dispatch<SetStateAction<PromptState>>) {
  const history = useRef<string[]>([]);
  const hydratedSessionKey = useRef('');
  const hydrationStartText = useRef('');
  const hydrationFromMemory = useRef(false);
  const draftMemory = useRef(new SessionPromptDraftMemory());
  const selectedSessionKey = useRef(sessionKey); selectedSessionKey.current = sessionKey;
  const mounted = useRef(false);
  const [browser, setBrowser] = useState<PromptHistoryBrowserState>(closedPromptHistoryBrowser);
  const browserRef = useRef(browser); browserRef.current = browser;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    let active = true;
    const outgoingSessionKey = hydratedSessionKey.current;
    const outgoingText = promptRef.current.text;
    const outgoingAuthoritative = Boolean(outgoingSessionKey) || hydrationFromMemory.current || outgoingText !== hydrationStartText.current;
    if (outgoingSessionKey && outgoingAuthoritative) {
      launchGuardedBackgroundTask(() => saveDraft(outgoingSessionKey, outgoingText));
    }
    const staged = draftMemory.current.enter(sessionKey, outgoingText, outgoingAuthoritative, promptRef.current);
    hydratedSessionKey.current = '';
    hydrationStartText.current = staged.text;
    hydrationFromMemory.current = staged.source === 'memory';
    // Scope, not text equality, owns the editor. Equal-text threads can have
    // different cursors and undo stacks. Rebase native authority on every switch
    // so callbacks queued by the outgoing thread cannot edit the restored one.
    setPrompt((current) => ({
      ...(staged.editor ?? createPromptState(staged.text)),
      pending: '', count: '', operatorCount: 1,
      authority: current.authority + 1,
      register: current.register, registerKind: current.registerKind, registerRevision: current.registerRevision,
    }));
    void Promise.all([loadDraft(sessionKey), loadPromptHistory(sessionKey)]).then(([restoredDraft, restoredHistory]) => {
      if (!active) return;
      history.current = restoredHistory;
      if (browserRef.current.open) {
        const refreshed = openPromptHistoryBrowser(restoredHistory);
        browserRef.current = refreshed;
        setBrowser(refreshed);
      }
      const currentText = promptRef.current.text;
      hydratedSessionKey.current = sessionKey;
      if (staged.source === 'memory') {
        draftMemory.current.remember(sessionKey, currentText);
        if (sessionKey) launchGuardedBackgroundTask(() => saveDraft(sessionKey, currentText));
        return;
      }
      // A slow SQLite read never outranks keyboard edits made after this
      // session became selected. If the user has already edited, that newer
      // draft becomes this session's authority instead of being overwritten.
      const decision = draftHydrationDecision(staged.text, currentText, restoredDraft);
      draftMemory.current.remember(sessionKey, decision.text);
      if (decision.kind === 'restore' && decision.text !== currentText) {
        hydrationStartText.current = decision.text;
        setPrompt((current) => ({ ...createPromptState(decision.text), authority: current.authority + 1, register: current.register, registerKind: current.registerKind, registerRevision: current.registerRevision }));
      } else launchGuardedBackgroundTask(() => saveDraft(sessionKey, decision.text));
    }).catch(() => undefined);
    browserRef.current = closedPromptHistoryBrowser;
    setBrowser(closedPromptHistoryBrowser);
    return () => { active = false; };
  }, [promptRef, sessionKey, setPrompt]);

  useEffect(() => {
    // During a session switch the prompt may still contain the previous
    // session's draft. Do not schedule that value into the newly selected key.
    if (hydratedSessionKey.current !== sessionKey) return;
    draftMemory.current.remember(sessionKey, prompt.text);
    const timer = setTimeout(() => { if (sessionKey) launchGuardedBackgroundTask(() => saveDraft(sessionKey, prompt.text)); }, 250);
    return () => clearTimeout(timer);
  }, [prompt.text, sessionKey]);

  const updateBrowser = useCallback((update: (current: PromptHistoryBrowserState) => PromptHistoryBrowserState) => {
    setBrowser((current) => {
      const next = update(current);
      browserRef.current = next;
      return next;
    });
  }, []);

  const closeBrowser = useCallback(() => updateBrowser(closePromptHistoryBrowser), [updateBrowser]);
  const openBrowser = useCallback(() => updateBrowser(() => openPromptHistoryBrowser(history.current)), [updateBrowser]);
  const toggleBrowser = useCallback(() => browserRef.current.open ? closeBrowser() : openBrowser(), [closeBrowser, openBrowser]);

  const acceptBrowser = useCallback((index?: number) => {
    const currentBrowser = browserRef.current;
    const selected = index === undefined ? promptHistorySelection(currentBrowser) : currentBrowser.entries[index];
    if (selected !== undefined) setPrompt((current) => acceptedPromptHistorySelection(current, selected));
    closeBrowser();
  }, [closeBrowser, setPrompt]);

  const recordSubmitted = useCallback((text: string) => {
    const submitted = text.trim();
    const ownsSelectedPrompt = submissionResultOwnsSelectedPrompt(sessionKey, selectedSessionKey.current, hydratedSessionKey.current);
    if (submitted && ownsSelectedPrompt) history.current = [...history.current.slice(-99), text];
    if (sessionKey) {
      if (submitted) launchGuardedBackgroundTask(() => appendPromptHistory(sessionKey, text));
      if (hydratedSessionKey.current === sessionKey) launchGuardedBackgroundTask(() => saveDraft(sessionKey, promptRef.current.text));
    }
    if (ownsSelectedPrompt) closeBrowser();
  }, [closeBrowser, promptRef, sessionKey]);

  const restoreRejected = useCallback((text: string) => {
    if (!sessionKey) return;
    const ownsSelectedPrompt = submissionResultOwnsSelectedPrompt(sessionKey, selectedSessionKey.current, hydratedSessionKey.current);
    if (ownsSelectedPrompt && !mounted.current) {
      const restored = restoredAfterRejectedSubmission(promptRef.current, text);
      draftMemory.current.remember(sessionKey, restored.text);
      launchGuardedBackgroundTask(() => saveDraft(sessionKey, restored.text));
      return;
    }
    if (ownsSelectedPrompt) {
      setPrompt((current) => {
        const restored = restoredAfterRejectedSubmission(current, text);
        draftMemory.current.remember(sessionKey, restored.text);
        launchGuardedBackgroundTask(() => saveDraft(sessionKey, restored.text));
        return restored;
      });
      return;
    }
    const revision = draftMemory.current.capture(sessionKey);
    launchGuardedBackgroundTask(() => loadDraft(sessionKey).then((loadedText) => {
      const merged = draftMemory.current.mergeLoaded(revision, loadedText, (laterText) => mergedRejectedDraft(text, laterText));
      const persisted = saveDraft(sessionKey, merged);
      // The user may return to the origin while the durable read is pending.
      // Publish into that prompt too, otherwise its ordinary draft debounce can
      // overwrite the correctly merged cache/store with the still-visible edit.
      if (mounted.current && selectedSessionKey.current === sessionKey) {
        setPrompt((current) => {
          if (!mounted.current || selectedSessionKey.current !== sessionKey) return current;
          const restored = restoredAfterRejectedSubmission(current, text);
          draftMemory.current.remember(sessionKey, restored.text);
          launchGuardedBackgroundTask(() => saveDraft(sessionKey, restored.text));
          return restored;
        });
      }
      return persisted;
    }));
  }, [promptRef, sessionKey, setPrompt]);

  const navigate = useCallback((direction: -1 | 1) => updateBrowser((current) => current.open
    ? movePromptHistoryBrowser(current, direction)
    : openPromptHistoryBrowser(history.current)), [updateBrowser]);

  const handleBrowserKey = useCallback((event: HardwareKeyEvent) => {
    const action = promptHistoryBrowserAction(browserRef.current, event);
    if (!browserRef.current.open) return false;
    if (action === 'cancel') closeBrowser();
    else if (action === 'accept') acceptBrowser();
    else if (action === 'older') navigate(-1);
    else if (action === 'newer') navigate(1);
    return true;
  }, [acceptBrowser, closeBrowser, navigate]);

  return { recordSubmitted, restoreRejected, navigate, browser, toggleBrowser, closeBrowser, acceptBrowser, handleBrowserKey };
}
