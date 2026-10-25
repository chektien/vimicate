export type IdentifiedViewportRequest = { datasetKey: string; target: number; rowKey?: string | undefined };

export function remapViewportRowRequest<T extends IdentifiedViewportRequest>(request: T | null, datasetKey: string, keys: readonly string[] | undefined): T | null {
  if (!request || !request.rowKey) return request;
  if (request.datasetKey !== datasetKey || !keys) return null;
  const target = keys.indexOf(request.rowKey);
  return target < 0 ? null : target === request.target ? request : { ...request, target };
}
export function sameViewportRowKeys(previous: readonly string[] | undefined, next: readonly string[] | undefined) {
  return previous === next || !!previous && !!next && previous.length === next.length && previous.every((key, index) => key === next[index]);
}
