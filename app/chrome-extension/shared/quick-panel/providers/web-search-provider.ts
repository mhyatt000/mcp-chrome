/**
 * Web Search Provider (Quick Panel)
 *
 * Scope-driven web search entries using prefix-only scopes:
 * - `g `   -> Google
 * - `gh `  -> GitHub
 * - `npm ` -> NPM
 * - `so `  -> Stack Overflow
 * - `mdn ` -> MDN
 *
 * This provider is intentionally excluded from the 'all' scope to avoid
 * polluting local-first results (tabs/bookmarks/history/content).
 */

import { buildSearchUrl } from '../core/url-template';
import type { Action, SearchProvider, SearchProviderContext, SearchResult } from '../core/types';
import { openUrl } from './provider-utils';

// ============================================================
// Types
// ============================================================

export type WebSearchScope =
  | 'web_google'
  | 'web_github'
  | 'web_npm'
  | 'web_stackoverflow'
  | 'web_mdn';

export interface WebSearchResultData {
  scope: WebSearchScope;
  url: string;
  query: string;
}

interface WebSearchEngineDef {
  scope: WebSearchScope;
  label: string;
  icon: string;
  template: string;
}

// ============================================================
// Engine Templates
// ============================================================

const WEB_SEARCH_ENGINES: Readonly<Record<WebSearchScope, WebSearchEngineDef>> = {
  web_google: {
    scope: 'web_google',
    label: 'Google',
    icon: '\uD83D\uDD0D', // 🔍
    template: 'https://www.google.com/search?q={rawQuery}',
  },
  web_github: {
    scope: 'web_github',
    label: 'GitHub',
    icon: '\uD83D\uDC19', // 🐙
    template: 'https://github.com/search?q={rawQuery}',
  },
  web_npm: {
    scope: 'web_npm',
    label: 'NPM',
    icon: '\uD83D\uDCE6', // 📦
    template: 'https://www.npmjs.com/search?q={rawQuery}',
  },
  web_stackoverflow: {
    scope: 'web_stackoverflow',
    label: 'Stack Overflow',
    icon: '\uD83D\uDCA1', // 💡
    template: 'https://stackoverflow.com/search?q={rawQuery}',
  },
  web_mdn: {
    scope: 'web_mdn',
    label: 'MDN',
    icon: '\uD83D\uDCDA', // 📚
    template: 'https://developer.mozilla.org/en-US/search?q={rawQuery}',
  },
} as const;

function isWebSearchScope(scope: unknown): scope is WebSearchScope {
  return (
    scope === 'web_google' ||
    scope === 'web_github' ||
    scope === 'web_npm' ||
    scope === 'web_stackoverflow' ||
    scope === 'web_mdn'
  );
}

// ============================================================
// Provider Factory
// ============================================================

export function createWebSearchProvider(): SearchProvider<WebSearchResultData> {
  const id = 'web-search';
  const name = 'Web Search';
  const icon = '\uD83C\uDF10'; // 🌐

  function getActions(item: SearchResult<WebSearchResultData>): Action<WebSearchResultData>[] {
    const { url } = item.data;

    return [
      {
        id: 'web.open',
        title: 'Open',
        hotkeyHint: 'Enter',
        execute: async (ctx) => {
          await openUrl({ url, disposition: ctx.openMode ?? 'current_tab' });
        },
      },
      {
        id: 'web.openNewTab',
        title: 'Open in new tab',
        hotkeyHint: 'Cmd/Ctrl+Enter',
        execute: async () => {
          await openUrl({ url, disposition: 'new_tab' });
        },
      },
    ];
  }

  async function search(ctx: SearchProviderContext): Promise<SearchResult<WebSearchResultData>[]> {
    if (ctx.signal.aborted) return [];

    const scope = ctx.requestedScope;
    if (!isWebSearchScope(scope)) return [];

    const rawQuery = String(ctx.query.raw ?? '').trim();
    if (!rawQuery) return [];

    const engine = WEB_SEARCH_ENGINES[scope];
    const url = buildSearchUrl({ template: engine.template }, rawQuery);

    const data: WebSearchResultData = {
      scope,
      url,
      query: rawQuery,
    };

    return [
      {
        id: `${scope}:${encodeURIComponent(rawQuery)}`,
        provider: id,
        title: `Search ${engine.label}`,
        subtitle: rawQuery,
        icon: engine.icon,
        data,
        score: 100,
      },
    ];
  }

  return {
    id,
    name,
    icon,
    scopes: ['web_google', 'web_github', 'web_npm', 'web_stackoverflow', 'web_mdn'],
    includeInAll: false,
    search,
    getActions,
  };
}
