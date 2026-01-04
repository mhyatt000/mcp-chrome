import type { ToolResult } from '@/common/tool-handler';

export interface QuickPanelDownloadInfo {
  downloadId?: number;
  filename?: string;
  fullPath?: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitizeFilenameSegment(value: string): string {
  const trimmed = normalizeString(value).trim();
  if (!trimmed) return 'quick_panel';
  return trimmed.replace(/[^a-z0-9_-]/gi, '_');
}

function sanitizePathSegment(value: string): string {
  const trimmed = normalizeString(value).trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return '';
  // Allow dots for common file extensions (e.g., ".json", ".png").
  return trimmed.replace(/[^a-z0-9._-]/gi, '_');
}

function sanitizeDownloadsRelativePath(value: string): string {
  const raw = normalizeString(value).trim().replace(/^\/+/, '');
  if (!raw) return 'quick_panel.txt';

  const parts = raw
    .split('/')
    .map((p) => sanitizePathSegment(p))
    .filter((p) => p);

  // Ensure we always return a file-like path.
  if (parts.length === 0) return 'quick_panel.txt';

  return parts.join('/');
}

function formatFilename(prefix: string, extension: string): string {
  const safePrefix = sanitizeFilenameSegment(prefix);
  const safeExt = sanitizeFilenameSegment(extension).replace(/^_+/, '').toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safePrefix}_${timestamp}.${safeExt || 'txt'}`;
}

export function getFirstTextContent(result: ToolResult | null | undefined): string | null {
  const first = result?.content?.[0];
  if (!first || first.type !== 'text') return null;
  const text = normalizeString(first.text).trim();
  return text ? text : null;
}

export async function saveTextToDownloads(options: {
  text: string;
  filenamePrefix: string;
  extension: string;
  mimeType: string;
}): Promise<QuickPanelDownloadInfo> {
  if (!chrome?.downloads?.download) {
    throw new Error('chrome.downloads.download is not available');
  }

  const text = normalizeString(options.text);
  const filename = formatFilename(options.filenamePrefix, options.extension);
  const mimeType = normalizeString(options.mimeType).trim() || 'text/plain';

  return saveTextToDownloadsPath({ text, filename, mimeType });
}

export async function saveTextToDownloadsPath(options: {
  text: string;
  filename: string;
  mimeType: string;
}): Promise<QuickPanelDownloadInfo> {
  if (!chrome?.downloads?.download) {
    throw new Error('chrome.downloads.download is not available');
  }

  const text = normalizeString(options.text);
  const filename = sanitizeDownloadsRelativePath(options.filename);
  const mimeType = normalizeString(options.mimeType).trim() || 'text/plain';

  // Using data URL keeps the flow MV3-friendly (no DOM / no filesystem APIs in service worker).
  // 这里选择 data URL 是为了避免引入额外的 offscreen/文件系统依赖，保持 Quick Panel 命令链路简单可审计。
  const base64 = btoa(unescape(encodeURIComponent(text)));
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

  try {
    await new Promise((r) => setTimeout(r, 100));
    const [item] = await chrome.downloads.search({ id: downloadId });
    return { downloadId, filename, fullPath: item?.filename };
  } catch {
    return { downloadId, filename };
  }
}

export async function saveBase64ToDownloadsPath(options: {
  base64Data: string;
  filename: string;
  mimeType: string;
}): Promise<QuickPanelDownloadInfo> {
  if (!chrome?.downloads?.download) {
    throw new Error('chrome.downloads.download is not available');
  }

  const base64Data = normalizeString(options.base64Data).trim();
  const filename = sanitizeDownloadsRelativePath(options.filename);
  const mimeType = normalizeString(options.mimeType).trim() || 'application/octet-stream';

  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

  try {
    await new Promise((r) => setTimeout(r, 100));
    const [item] = await chrome.downloads.search({ id: downloadId });
    return { downloadId, filename, fullPath: item?.filename };
  } catch {
    return { downloadId, filename };
  }
}
