/**
 * Quick Panel Toolbox - UUID
 */

function randomHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function generateUuidV4(): string {
  try {
    if (typeof crypto?.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall back to getRandomValues/Math.random.
  }

  let bytes: Uint8Array | null = null;
  try {
    if (typeof crypto?.getRandomValues === 'function') {
      bytes = crypto.getRandomValues(new Uint8Array(16));
    }
  } catch {
    bytes = null;
  }

  if (!bytes) {
    bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 version 4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = randomHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
