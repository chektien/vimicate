/** Host allowlist; Quick Look decides whether this device can display the bytes. */
export const documentPreviewMimeTypes = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf', 'application/vnd.apple.pages', 'application/vnd.apple.numbers',
  'application/vnd.apple.keynote', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
  'audio/aiff', 'audio/x-caf', 'video/mp4', 'video/quicktime', 'application/zip',
]);
