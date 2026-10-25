const MAX_GATEWAY_FRAME_BYTES = 25 * 1024 * 1024;

/** Base64 expansion and prompt/JSON overhead all count against the wire limit. */
export function serializedGatewayFrame(frame: { method?: string; [key: string]: unknown }) {
  const serialized = JSON.stringify(frame);
  if (frame.method === 'chat.send') {
    // Base64 and JSON punctuation are ASCII. Skip those large spans in the
    // engine instead of running JS once for every encoded attachment byte.
    let bytes = serialized.length;
    const nonASCII = /[\u0080-\uffff]+/g;
    let match: RegExpExecArray | null;
    while (bytes <= MAX_GATEWAY_FRAME_BYTES && (match = nonASCII.exec(serialized))) {
      for (let i = 0; i < match[0].length; i += 1) {
        const point = match[0].charCodeAt(i);
        bytes += point <= 0x7ff ? 1 : 2;
        // JSON.stringify escapes lone surrogates, so a literal high surrogate
        // here always starts a pair. Four UTF-8 bytes replace two code units.
        if (point >= 0xd800 && point <= 0xdbff) i += 1;
      }
    }
    if (bytes > MAX_GATEWAY_FRAME_BYTES) throw new Error('Message and attachments exceed the connection upload budget. Shorten the prompt or remove an attachment.');
  }
  return serialized;
}
