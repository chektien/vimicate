/** Size the raw page before advancing its cursor; rejected large reads publish nothing. */
export async function loadPresentationBoundedOlderPage<T>(initialLimit: number,
  load: (limit: number) => Promise<T>, owns: () => boolean, fits: (page: T) => boolean): Promise<T | null> {
  // At most eight reads (128→64→…→1). One raw record is indivisible; the
  // presentation owner retains that record plus its existing review boundary.
  for (let limit = initialLimit; ; limit = Math.max(1, Math.floor(limit / 2))) {
    if (!owns()) return null;
    const page = await load(limit);
    if (!owns()) return null;
    if (limit === 1 || fits(page)) return page;
  }
}
