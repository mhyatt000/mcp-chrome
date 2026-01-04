/**
 * Web Monitor helper (Offscreen Document)
 *
 * Runs network fetch + DOM extraction in an offscreen document so we can use DOMParser.
 * This keeps the background service worker free of DOM dependencies.
 */

import { MessageTarget, OFFSCREEN_MESSAGE_TYPES } from '@/common/message-types';

// ============================================================
// Types
// ============================================================

type ExtractorKind = 'selector_text' | 'selector_attr';

interface WebMonitorFetchExtractMessage {
  target: MessageTarget;
  type: typeof OFFSCREEN_MESSAGE_TYPES.WEB_MONITOR_FETCH_EXTRACT;
  url: string;
  extractor: ExtractorKind;
  selector: string;
  attribute?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

interface WebMonitorFetchExtractResponse {
  success: boolean;
  error?: string;
  url?: string;
  status?: number;
  extracted?: string | null;
  title?: string | null;
  byteLength?: number;
}

// ============================================================
// Helpers
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  const int = Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, int));
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function normalizeUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('url is required');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Allow hostnames without scheme (assume https).
    url = new URL(`https://${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }

  // Avoid fragment noise for monitoring.
  url.hash = '';
  return url.toString();
}

function normalizeSelector(selector: string): string {
  const s = String(selector ?? '').trim();
  if (!s) throw new Error('selector is required');
  if (s.length > 500) throw new Error('selector is too long');
  return s;
}

function normalizeExtractor(kind: unknown): ExtractorKind {
  return kind === 'selector_attr' ? 'selector_attr' : 'selector_text';
}

function normalizeAttribute(attr: unknown): string | null {
  const a = String(attr ?? '').trim();
  if (!a) return null;
  if (a.length > 100) throw new Error('attribute is too long');
  return a;
}

async function readTextWithCap(
  resp: Response,
  maxBytes: number,
): Promise<{ text: string; byteLength: number }> {
  const contentLength = resp.headers.get('content-length');
  const declared = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Response is too large (${Math.floor(declared)} bytes)`);
  }

  const body = resp.body;
  if (!body) {
    const text = await resp.text();
    const byteLength = new TextEncoder().encode(text).length;
    if (byteLength > maxBytes) throw new Error(`Response is too large (${byteLength} bytes)`);
    return { text, byteLength };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          reader.cancel();
        } catch {
          // ignore
        }
        throw new Error(`Response is too large (> ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  }

  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(all);
  return { text, byteLength: total };
}

function collapseWhitespace(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFromHtml(options: {
  html: string;
  extractor: ExtractorKind;
  selector: string;
  attribute: string | null;
}): { extracted: string; title: string | null } {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in offscreen document');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(options.html, 'text/html');

  const title = collapseWhitespace(doc.querySelector('title')?.textContent || '') || null;

  const el = doc.querySelector(options.selector);
  if (!el) {
    throw new Error(`Selector not found: ${options.selector}`);
  }

  if (options.extractor === 'selector_attr') {
    const attr = options.attribute;
    if (!attr) throw new Error('attribute is required for selector_attr');
    const v = el.getAttribute(attr);
    if (v == null) throw new Error(`Attribute "${attr}" not found`);
    return { extracted: collapseWhitespace(v), title };
  }

  return { extracted: collapseWhitespace(el.textContent || ''), title };
}

async function fetchAndExtract(
  message: WebMonitorFetchExtractMessage,
): Promise<WebMonitorFetchExtractResponse> {
  const url = normalizeUrl(message.url);
  const extractor = normalizeExtractor(message.extractor);
  const selector = normalizeSelector(message.selector);
  const attribute = normalizeAttribute(message.attribute);

  const timeoutMs = clampInt(message.timeoutMs, 10_000, 1_000, 60_000);
  const maxBytes = clampInt(message.maxBytes, 2_000_000, 100_000, 10_000_000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });

    const { text: html, byteLength } = await readTextWithCap(resp, maxBytes);

    const { extracted, title } = extractFromHtml({ html, extractor, selector, attribute });

    return {
      success: true,
      url: resp.url || url,
      status: resp.status,
      extracted,
      title,
      byteLength,
    };
  } catch (err) {
    return { success: false, error: safeErrorMessage(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function isWebMonitorMessage(message: unknown): message is WebMonitorFetchExtractMessage {
  if (!isRecord(message)) return false;
  if (message.target !== MessageTarget.Offscreen) return false;
  return message.type === OFFSCREEN_MESSAGE_TYPES.WEB_MONITOR_FETCH_EXTRACT;
}

// ============================================================
// Message Handler
// ============================================================

export function handleWebMonitorMessage(
  message: unknown,
  sendResponse: (response: WebMonitorFetchExtractResponse) => void,
): boolean {
  if (!isWebMonitorMessage(message)) return false;

  void fetchAndExtract(message).then(sendResponse);
  return true;
}
