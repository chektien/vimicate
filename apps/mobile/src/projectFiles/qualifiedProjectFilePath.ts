/** A named host root is a virtual Files directory, never a host-relative path. */
export function qualifiedProjectFilePath(source: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9.-]{0,63}\//u.test(source);
}
