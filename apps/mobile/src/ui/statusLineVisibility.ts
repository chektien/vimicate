export type StatusLineVisibility = {
  path: boolean;
  branch: boolean;
  quota: boolean;
  position: boolean;
};

/**
 * Compact workspace chrome removes descriptive fields, not operational state.
 * Quota remains visible and the lower-priority detail text yields space to it.
 */
export function statusLineVisibility(compact: boolean): StatusLineVisibility {
  return {
    path: !compact,
    branch: !compact,
    quota: true,
    position: !compact,
  };
}
