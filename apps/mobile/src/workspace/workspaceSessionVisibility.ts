export function isHiddenWorkspaceSession(sessionKey: string, label: string) {
  const normalizedKey = sessionKey.trim().toLocaleLowerCase();
  const normalizedLabel = label.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  if (normalizedLabel === 'visible background run' || normalizedKey.includes('visible-background-run-smoke')) return true;
  return /^vimicate control(?:\s|$)/.test(normalizedLabel)
    || /(?:^|[:/_-])vimicate[-_ ]?control(?:[:/_-]|$)/.test(normalizedKey);
}
