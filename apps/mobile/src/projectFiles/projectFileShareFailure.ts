/** Translate known failures without exposing arbitrary host paths or diagnostics. */
export function projectFileShareFailure(error: unknown, presenting: boolean): string {
  if (presenting) return 'The file downloaded, but the share sheet could not open. Try again.';
  const message = error instanceof Error ? error.message : '';
  if (/^(?:health|connect|sessions\.subscribe) timed out$|^Gateway challenge timed out$/i.test(message)) {
    return 'The Gateway connection timed out. Wait for it to reconnect, then try sharing again.';
  }
  if (/^Gateway (?:is not connected|disconnected|connection was replaced\.?)$|^WebSocket transport error$/i.test(message)) {
    return 'The Gateway is disconnected. Wait for it to reconnect, then try sharing again.';
  }
  if (/^vimicate\.files\.exportChunk timed out$/i.test(message)) return 'The file download timed out. Try sharing again.';
  if (/unknown method:\s*vimicate\.files\.exportChunk$/i.test(message)) return 'This Gateway needs an update to support original-file sharing.';
  if (/^vimicate project files: share file exceeds 33554432 bytes$/i.test(message)) {
    return 'This Gateway needs an update to stream files larger than 32 MiB.';
  }
  if (/Not enough free space/i.test(message)) return 'Not enough free space on this device to download the original. Free up space and try again.';
  if (/^vimicate project files: file changed before sharing$/i.test(message)) return 'The file changed. Refresh the folder, then share it again.';
  if (message === 'Invalid original file transfer response.') return 'The file transfer could not be verified. Nothing was shared. Try again.';
  return 'The original file could not be downloaded. Try again.';
}
