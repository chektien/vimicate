export function projectFilesPresentationForDevice(os: string, isPad: boolean): 'sidebar' | 'overlay' {
  return os === 'ios' && isPad ? 'sidebar' : 'overlay';
}
