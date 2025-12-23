/**
 * Floating Drag Utility
 *
 * A helper for making Shadow DOM floating UI draggable via a dedicated handle.
 *
 * Features:
 * - Pointer capture for robust tracking across the viewport
 * - Viewport clamping with a configurable margin
 * - Escape key cancels the active drag and restores the start position
 *
 * Notes:
 * - This utility blocks pointer events during an active drag to
 *   prevent page interactions while moving the editor UI.
 */

// =============================================================================
// Types
// =============================================================================

export interface FloatingPosition {
  left: number;
  top: number;
}

export interface FloatingDragOptions {
  /** Element that triggers the drag (handle) */
  handleEl: HTMLElement;
  /** Element to be moved */
  targetEl: HTMLElement;
  /** Called when position changes during or after drag */
  onPositionChange: (position: FloatingPosition) => void;
  /** Margin from viewport edges in pixels */
  clampMargin: number;
}

interface DragSession {
  pointerId: number;
  startPosition: FloatingPosition;
  offsetX: number;
  offsetY: number;
  targetWidth: number;
  targetHeight: number;
}

// =============================================================================
// Constants
// =============================================================================

const WINDOW_CAPTURE: AddEventListenerOptions = { capture: true, passive: false };

// =============================================================================
// Helpers
// =============================================================================

function blockEvent(event: Event): void {
  if (event.cancelable) {
    event.preventDefault();
  }
  event.stopImmediatePropagation();
  event.stopPropagation();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}

function clampPosition(
  position: FloatingPosition,
  size: { width: number; height: number },
  clampMargin: number,
  viewport: { width: number; height: number },
): FloatingPosition {
  const margin = Number.isFinite(clampMargin) ? Math.max(0, clampMargin) : 0;
  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  const maxTop = Math.max(margin, viewport.height - margin - size.height);

  return {
    left: clampNumber(position.left, margin, maxLeft),
    top: clampNumber(position.top, margin, maxTop),
  };
}

function roundPosition(position: FloatingPosition): FloatingPosition {
  return { left: Math.round(position.left), top: Math.round(position.top) };
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Install drag behavior on a floating UI element.
 *
 * @returns Cleanup function to remove all event listeners
 */
export function installFloatingDrag(options: FloatingDragOptions): () => void {
  const { handleEl, targetEl, onPositionChange, clampMargin } = options;

  let session: DragSession | null = null;
  let disposed = false;

  function teardownWindowListeners(): void {
    window.removeEventListener('pointermove', onWindowPointerMove, WINDOW_CAPTURE);
    window.removeEventListener('pointerup', onWindowPointerUp, WINDOW_CAPTURE);
    window.removeEventListener('pointercancel', onWindowPointerCancel, WINDOW_CAPTURE);
    window.removeEventListener('keydown', onWindowKeyDown, WINDOW_CAPTURE);
    window.removeEventListener('blur', onWindowBlur, WINDOW_CAPTURE);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  function endDrag(pointerId: number): void {
    const s = session;
    if (!s) return;
    if (s.pointerId !== pointerId) return;

    try {
      handleEl.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may be unavailable or already released
    }

    teardownWindowListeners();
    session = null;
    handleEl.dataset.dragging = 'false';
  }

  function applyNextPosition(next: FloatingPosition): void {
    const s = session;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    const size = s
      ? { width: s.targetWidth, height: s.targetHeight }
      : (() => {
          const rect = targetEl.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })();

    const clamped = clampPosition(next, size, clampMargin, viewport);
    onPositionChange(roundPosition(clamped));
  }

  function cancelDrag(): void {
    const s = session;
    if (!s) return;
    applyNextPosition(s.startPosition);
    endDrag(s.pointerId);
  }

  function onWindowPointerMove(event: PointerEvent): void {
    const s = session;
    if (!s) return;
    if (event.pointerId !== s.pointerId) return;

    blockEvent(event);

    applyNextPosition({
      left: event.clientX - s.offsetX,
      top: event.clientY - s.offsetY,
    });
  }

  function onWindowPointerUp(event: PointerEvent): void {
    const s = session;
    if (!s) return;
    if (event.pointerId !== s.pointerId) return;

    blockEvent(event);
    endDrag(event.pointerId);
  }

  function onWindowPointerCancel(event: PointerEvent): void {
    const s = session;
    if (!s) return;
    if (event.pointerId !== s.pointerId) return;

    blockEvent(event);
    cancelDrag();
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (!session) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    cancelDrag();
  }

  function onWindowBlur(): void {
    if (!session) return;
    cancelDrag();
  }

  function onVisibilityChange(): void {
    if (!session) return;
    if (document.visibilityState === 'hidden') {
      cancelDrag();
    }
  }

  function onHandlePointerDown(event: PointerEvent): void {
    if (disposed) return;
    if (!targetEl.isConnected) return;

    // Prevent re-entry if drag is already in progress
    if (session) return;

    // Left click only (touch typically reports button=0 too)
    if (event.button !== 0) return;
    if (!event.isPrimary) return;

    blockEvent(event);

    const rect = targetEl.getBoundingClientRect();
    const startPosition = roundPosition({ left: rect.left, top: rect.top });

    session = {
      pointerId: event.pointerId,
      startPosition,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      targetWidth: rect.width,
      targetHeight: rect.height,
    };

    handleEl.dataset.dragging = 'true';

    try {
      handleEl.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail on some elements/browsers
    }

    window.addEventListener('pointermove', onWindowPointerMove, WINDOW_CAPTURE);
    window.addEventListener('pointerup', onWindowPointerUp, WINDOW_CAPTURE);
    window.addEventListener('pointercancel', onWindowPointerCancel, WINDOW_CAPTURE);
    window.addEventListener('keydown', onWindowKeyDown, WINDOW_CAPTURE);
    window.addEventListener('blur', onWindowBlur, WINDOW_CAPTURE);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // Initialize
  handleEl.dataset.dragging = 'false';
  handleEl.addEventListener('pointerdown', onHandlePointerDown);

  // Return cleanup function
  return () => {
    disposed = true;
    handleEl.removeEventListener('pointerdown', onHandlePointerDown);

    // Best-effort teardown if a drag is active
    if (session) {
      try {
        cancelDrag();
      } catch {
        // ignore
      }
    }

    teardownWindowListeners();
    session = null;
    handleEl.dataset.dragging = 'false';
  };
}
