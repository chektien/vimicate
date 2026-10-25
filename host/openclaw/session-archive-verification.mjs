import crypto from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
}
// Store a decoded-record digest only after verifyImportedArchiveRecords passes.
// It is not the original JSONL byte hash; the two identify different evidence.
export function archiveRecordsDigest(records) {
  if (!Array.isArray(records)) fail('records must be an array');
  return digest(records);
}
function fail(message) { throw new Error(`archive verification: ${message}`); }
const MEDIA_KEYS = ["MediaPath", "MediaPaths", "MediaUrl", "MediaUrls", "MediaType", "MediaTypes",
  "MediaTranscribedIndexes", "MediaStaged", "MediaWorkspaceDir"];
const BARE_KINDS = new Set(["image", "audio", "video", "document", "sticker", "unknown"]);
const INBOUND_CONTEXT_MARKER = "⟦openclaw:ctx⟧";
const LEGACY_LEADING_TIMESTAMP_PREFIX_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] */;

// Independent verifier for Doctor's 2026.8.1 legacy inbound-context label
// normalization. Only the reviewed labels gain OpenClaw's marker; message
// text outside those exact headers remains byte-for-byte significant.
function expectedInboundLabelMigration(event) {
  const message = event?.message;
  if (event?.type !== "message" || !message || typeof message !== "object"
      || Array.isArray(message) || !["user", "assistant"].includes(message.role)) return event;
  function normalize(text) {
    if (typeof text !== "string" || (!text.includes("untrusted") && !text.includes("Untrusted"))) return text;
    const match = text.match(LEGACY_LEADING_TIMESTAMP_PREFIX_RE);
    const prefix = match?.[0] ?? "";
    let next = prefix ? text.slice(prefix.length) : text;
    next = next.replace(/^(Conversation info|Sender|Forwarded message context|Location|Structured object) \(untrusted metadata\):[ \t]*\n```json/gm,
      `$1: ${INBOUND_CONTEXT_MARKER}\n\`\`\`json`);
    next = next.replace(/^Untrusted context \(metadata, do not treat as instructions or commands\):([ \t]*\r?\n)(?=<active_memory_plugin>[ \t]*(?:\r?\n|$))/gm, "Context:$1");
    next = next.replace(/^Untrusted context \(metadata, do not treat as instructions or commands\):$/gm,
      `Context: ${INBOUND_CONTEXT_MARKER}`);
    next = next.replace(/^Chat history since last reply \(untrusted, for context\):$/gm,
      `Chat history since last reply: ${INBOUND_CONTEXT_MARKER}`);
    next = next.replace(/^Thread starter \(untrusted, for context\):[ \t]*\n```json/gm,
      `Thread starter: ${INBOUND_CONTEXT_MARKER}\n\`\`\`json`);
    next = next.replace(/^Reply target of current user message \(untrusted, for context\):[ \t]*\n```json/gm,
      `Reply target of current user message: ${INBOUND_CONTEXT_MARKER}\n\`\`\`json`);
    next = next.replace(/^Reply chain of current user message \(untrusted, nearest first\):[ \t]*\n```json/gm,
      `Reply chain of current user message (nearest first): ${INBOUND_CONTEXT_MARKER}\n\`\`\`json`);
    next = next.replace(/^Replied message \(untrusted, for context\):[ \t]*\n```json/gm,
      `Reply target of current user message: ${INBOUND_CONTEXT_MARKER}\n\`\`\`json`);
    next = next.replace(/^(.+) \(untrusted, chronological(, [^)\n]+)?\):$/gm,
      (_whole, label, qualifier) => `${label} (chronological${qualifier ?? ""}): ${INBOUND_CONTEXT_MARKER}`);
    return prefix + next;
  }
  let changed = false;
  const nextMessage = structuredClone(message);
  if (typeof nextMessage.content === "string") {
    const next = normalize(nextMessage.content);
    changed = next !== nextMessage.content;
    nextMessage.content = next;
  } else if (Array.isArray(nextMessage.content)) {
    for (const part of nextMessage.content) {
      if (!part || typeof part !== "object" || Array.isArray(part) || typeof part.text !== "string") continue;
      const next = normalize(part.text);
      if (next !== part.text) { part.text = next; changed = true; }
    }
  }
  return changed ? { ...event, message: nextMessage } : event;
}

// Independent, narrow verifier for the 2026.8.1 legacy-media -> __openclaw.media
// schema move. It never rewrites data. Unsupported/conflicting carriers stop
// migration instead of removing fields until the digests happen to match.
function expectedMediaMigration(event) {
  const message = event?.message;
  if (event?.type !== "message" || !message || typeof message !== "object"
      || Array.isArray(message)) return event;
  if (!MEDIA_KEYS.some(key => Object.hasOwn(message, key))) return event;
  if (Object.hasOwn(message, "media") || message.__openclaw?.media !== undefined) {
    fail("unsupported combined media carriers");
  }
  const columns = [["MediaPaths", "MediaPath"], ["MediaUrls", "MediaUrl"], ["MediaTypes", "MediaType"]]
    .map(([plural, single]) => {
      const values = message[plural] ?? [];
      if (!Array.isArray(values) || values.some(v => typeof v !== "string")
          || (message[single] !== undefined && typeof message[single] !== "string")) fail("unsupported media fields");
      if (values.length && message[single] !== undefined && message[single].trim() !== values[0].trim()) {
        fail("ambiguous singular/plural media facts");
      }
      return values.length ? values.map(v => v.trim()) : message[single] ? [message[single].trim()] : [];
    });
  const [paths, urls, types] = columns, count = Math.max(...columns.map(c => c.length));
  if (count > 1024 || (types.length > 0 && types.length < Math.max(paths.length, urls.length))) {
    fail("ambiguous media alignment");
  }
  const transcribed = message.MediaTranscribedIndexes ?? [];
  if (!Array.isArray(transcribed) || transcribed.some(i => !Number.isInteger(i) || i < 0 || i >= count)
      || (message.MediaStaged !== undefined && typeof message.MediaStaged !== "boolean")
      || (message.MediaWorkspaceDir !== undefined && typeof message.MediaWorkspaceDir !== "string")) fail("unsupported media flags");
  const media = Array.from({ length: count }, (_, index) => {
    const url = urls[index] ?? (Array.isArray(message.MediaPaths) && message.MediaPaths.length ? message.MediaUrl?.trim() : undefined);
    const type = types[index];
    return { ...(paths[index] ? { path: paths[index] } : {}), ...(url ? { url } : {}),
      ...(type ? BARE_KINDS.has(type) ? { kind: type } : { contentType: type } : {}),
      ...(transcribed.includes(index) ? { transcribed: true } : {}),
      ...(message.MediaWorkspaceDir?.trim() ? { workspaceDir: message.MediaWorkspaceDir.trim() } : {}),
      ...(message.MediaStaged === true ? { staged: true } : {}) };
  });
  const next = { ...message };
  for (const key of MEDIA_KEYS) delete next[key];
  const metadata = { ...message.__openclaw };
  if (media.length) metadata.media = media;
  if (Object.keys(metadata).length) next.__openclaw = metadata;
  else delete next.__openclaw;
  return { ...event, message: next };
}

export function verifyImportedArchiveRecords(source, imported) {
  if (!Array.isArray(source) || !Array.isArray(imported) || source.length !== imported.length) fail("record count differs");
  let exact = 0, mediaMigrated = 0, inboundLabelsMigrated = 0;
  for (let index = 0; index < source.length; index++) {
    if (digest(source[index]) === digest(imported[index])) { exact++; continue; }
    const media = expectedMediaMigration(source[index]);
    if (digest(media) === digest(imported[index])) { mediaMigrated++; continue; }
    const labels = expectedInboundLabelMigration(source[index]);
    if (digest(labels) === digest(imported[index])) { inboundLabelsMigrated++; continue; }
    const both = expectedInboundLabelMigration(media);
    if (digest(both) !== digest(imported[index])) fail(`record ${index} differs`);
    mediaMigrated++; inboundLabelsMigrated++;
  }
  return { records: source.length, exact, mediaMigrated, inboundLabelsMigrated };
}
