import { initNativeHostListener } from './native-host';
import {
  initSemanticSimilarityListener,
  initializeSemanticEngineIfCached,
} from './semantic-similarity';
import { initStorageManagerListener } from './storage-manager';
import { cleanupModelCache } from '@/utils/semantic-similarity-engine';
import { initElementMarkerListeners } from './element-marker';
import { initWebEditorListeners } from './web-editor';
import { initQuickPanelAgentHandler } from './quick-panel/agent-handler';
import { initQuickPanelBookmarksHandler } from './quick-panel/bookmarks-handler';
import { initQuickPanelCommands } from './quick-panel/commands';
import { initQuickPanelContentHandler } from './quick-panel/content-handler';
import { initQuickPanelClipboardHandler } from './quick-panel/clipboard-handler';
import { initQuickPanelFocusHandler } from './quick-panel/focus-handler';
import { initQuickPanelNotesHandler } from './quick-panel/notes-handler';
import { initQuickPanelHistoryHandler } from './quick-panel/history-handler';
import { initQuickPanelMonitorHandler } from './quick-panel/monitor-handler';
import { initQuickPanelApiDetectiveHandler } from './quick-panel/api-detective-handler';
import { initQuickPanelAuditHandler } from './quick-panel/audit-handler';
import { initQuickPanelPageCommandsHandler } from './quick-panel/page-commands-handler';
import { initQuickPanelTabsHandler } from './quick-panel/tabs-handler';
import { initQuickPanelUsageHistoryHandler } from './quick-panel/usage-history-handler';
import { initQuickPanelWorkspacesHandler } from './quick-panel/workspaces-handler';

// Record-Replay V3
import { bootstrapV3 } from './record-replay-v3/bootstrap';

/**
 * Background script entry point
 * Initializes all background services and listeners
 */
export default defineBackground(() => {
  // Open welcome page on first install
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // Open the welcome/onboarding page for new installations
      chrome.tabs.create({
        url: chrome.runtime.getURL('/welcome.html'),
      });
    }
  });

  // Initialize core services
  initNativeHostListener();
  initSemanticSimilarityListener();
  initStorageManagerListener();

  // Record & Replay V3
  bootstrapV3()
    .then((runtime) => {
      console.log(`[RR-V3] Bootstrap complete, ownerId: ${runtime.ownerId}`);
    })
    .catch((error) => {
      console.error('[RR-V3] Bootstrap failed:', error);
    });

  // Element marker: context menu + CRUD listeners
  initElementMarkerListeners();
  // Web editor: toggle edit-mode overlay
  initWebEditorListeners();
  // Quick Panel: send messages to AgentChat via background-stream bridge
  initQuickPanelAgentHandler();
  // Quick Panel: tabs search bridge for content script UI
  initQuickPanelTabsHandler();
  // Quick Panel: bookmarks search bridge
  initQuickPanelBookmarksHandler();
  // Quick Panel: history search bridge
  initQuickPanelHistoryHandler();
  // Quick Panel: content search bridge (cached readable text)
  initQuickPanelContentHandler();
  // Quick Panel: clipboard history (records Quick Panel copy actions)
  initQuickPanelClipboardHandler();
  // Quick Panel: focus mode (Pomodoro / Focus)
  initQuickPanelFocusHandler();
  // Quick Panel: quick notes (local-first)
  initQuickPanelNotesHandler();
  // Quick Panel: web monitor / price track (optional)
  initQuickPanelMonitorHandler();
  // Quick Panel: usage history (frecency) store - IndexedDB backend
  initQuickPanelUsageHistoryHandler();
  // Quick Panel: navigation and page commands
  initQuickPanelPageCommandsHandler();
  // Quick Panel: API Detective (diagnostics)
  initQuickPanelApiDetectiveHandler();
  // Quick Panel: audit log (Agent Mode)
  initQuickPanelAuditHandler();
  // Quick Panel: workspaces (session snapshots)
  initQuickPanelWorkspacesHandler();
  // Quick Panel: keyboard shortcut handler
  initQuickPanelCommands();

  // Conditionally initialize semantic similarity engine if model cache exists
  initializeSemanticEngineIfCached()
    .then((initialized) => {
      if (initialized) {
        console.log('Background: Semantic similarity engine initialized from cache');
      } else {
        console.log(
          'Background: Semantic similarity engine initialization skipped (no cache found)',
        );
      }
    })
    .catch((error) => {
      console.warn('Background: Failed to conditionally initialize semantic engine:', error);
    });

  // Initial cleanup on startup
  cleanupModelCache().catch((error) => {
    console.warn('Background: Initial cache cleanup failed:', error);
  });
});
