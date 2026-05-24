import { describe, expect, it } from 'vitest';

import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a url-safe base64 string into the expected bytes', () => {
    // "hello" => base64 "aGVsbG8=" => url-safe (no padding) "aGVsbG8"
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(bytes)).toEqual([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('translates - and _ back to + and / and pads correctly', () => {
    // bytes [0xfb, 0xff, 0xbf] -> standard base64 "+/+/" -> url-safe "-_-_"
    // Use a 4-byte input to avoid padding ambiguity: [0xfb, 0xff, 0xbf, 0xfe]
    // standard base64: "+/+//g==" -> url-safe: "-_-__g"
    const bytes = urlBase64ToUint8Array('-_-__g');
    expect(Array.from(bytes)).toEqual([0xfb, 0xff, 0xbf, 0xfe]);
  });

  it('handles strings that need padding', () => {
    // "M" -> "TQ==" -> url-safe no padding "TQ"
    const bytes = urlBase64ToUint8Array('TQ');
    expect(Array.from(bytes)).toEqual([0x4d]);
  });
});
