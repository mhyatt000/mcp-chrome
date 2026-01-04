export interface ApiDetectiveRequestForSnippet {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeString(k).trim();
    const val = normalizeString(v).trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return out;
}

function shellSingleQuote(value: string): string {
  // POSIX-safe single-quote escaping:
  // abc'd -> 'abc'"'"'d'
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function shouldOmitHeader(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Avoid headers that are typically injected by the user agent or can break replay when copied verbatim.
  return (
    lower === 'host' ||
    lower === 'content-length' ||
    lower === 'connection' ||
    lower === 'accept-encoding'
  );
}

export function toCurlCommand(input: ApiDetectiveRequestForSnippet): string {
  const method = normalizeString(input.method).trim().toUpperCase() || 'GET';
  const url = normalizeString(input.url).trim();
  const headers = normalizeHeaders(input.headers);
  const body = typeof input.body === 'string' ? input.body : undefined;

  if (!url) return 'curl';

  const parts: string[] = ['curl'];

  if (method !== 'GET') {
    parts.push('-X', shellSingleQuote(method));
  }

  const headerKeys = Object.keys(headers)
    .filter((k) => k && !shouldOmitHeader(k))
    .sort((a, b) => a.localeCompare(b));
  for (const key of headerKeys) {
    parts.push('-H', shellSingleQuote(`${key}: ${headers[key]}`));
  }

  if (typeof body === 'string' && body.length > 0 && method !== 'GET' && method !== 'HEAD') {
    parts.push('--data-raw', shellSingleQuote(body));
  }

  parts.push(shellSingleQuote(url));
  return parts.join(' ');
}

export function toFetchSnippet(input: ApiDetectiveRequestForSnippet): string {
  const method = normalizeString(input.method).trim().toUpperCase() || 'GET';
  const url = normalizeString(input.url).trim();
  const headers = normalizeHeaders(input.headers);
  const body = typeof input.body === 'string' ? input.body : undefined;

  if (!url) return `await fetch(${JSON.stringify('')});`;

  const lines: string[] = [];
  lines.push(`await fetch(${JSON.stringify(url)}, {`);
  lines.push(`  method: ${JSON.stringify(method)},`);

  const headerKeys = Object.keys(headers)
    .filter((k) => k && !shouldOmitHeader(k))
    .sort((a, b) => a.localeCompare(b));
  if (headerKeys.length > 0) {
    lines.push('  headers: {');
    for (const key of headerKeys) {
      lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(headers[key])},`);
    }
    lines.push('  },');
  }

  if (typeof body === 'string' && body.length > 0 && method !== 'GET' && method !== 'HEAD') {
    lines.push(`  body: ${JSON.stringify(body)},`);
  }

  lines.push('});');
  return lines.join('\n');
}
