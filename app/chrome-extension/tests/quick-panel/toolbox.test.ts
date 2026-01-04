import { describe, expect, it } from 'vitest';

import {
  base64DecodeUtf8,
  base64EncodeUtf8,
  convertUnixTimestamp,
  decodeJwt,
  formatJson,
  generateUuidV4,
  urlDecode,
  urlEncode,
} from '@/shared/quick-panel/core/toolbox';

describe('Quick Panel toolbox', () => {
  it('formats json (pretty + minified)', () => {
    const res = formatJson('{"a":1,"b":[2,3]}');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.minified).toBe('{"a":1,"b":[2,3]}');
    expect(res.value.pretty).toContain('\n');
    expect(res.value.pretty).toContain('"b": [');
  });

  it('base64 encodes and decodes utf-8', () => {
    const encoded = base64EncodeUtf8('你好, world');
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = base64DecodeUtf8(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toBe('你好, world');
  });

  it('url encodes and decodes', () => {
    const encoded = urlEncode('你好 world?x=1');
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = urlDecode(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toBe('你好 world?x=1');
  });

  it('converts unix timestamp in seconds and milliseconds', () => {
    const s = convertUnixTimestamp('1699123456');
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.seconds).toBe(1699123456);
    expect(s.value.milliseconds).toBe(1699123456000);
    expect(s.value.iso).toBe(new Date(1699123456000).toISOString());

    const ms = convertUnixTimestamp('1699123456000');
    expect(ms.ok).toBe(true);
    if (!ms.ok) return;
    expect(ms.value.seconds).toBe(1699123456);
    expect(ms.value.milliseconds).toBe(1699123456000);
  });

  it('generates uuid v4', () => {
    const id = generateUuidV4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('decodes jwt header and payload', () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const res = decodeJwt(token);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(res.value.payload).toMatchObject({
      sub: '1234567890',
      name: 'John Doe',
      iat: 1516239022,
    });
  });
});
