/**
 * CSS Value Helpers
 *
 * Shared utilities for parsing and normalizing CSS values.
 * Used by control components for input-container suffix management.
 */

/**
 * Extract CSS unit suffix from a length value.
 * Supports px, %, rem, em, vh, vw, etc.
 * Falls back to 'px' for pure numbers or unknown patterns.
 *
 * @example
 * extractUnitSuffix('100px') // 'px'
 * extractUnitSuffix('50%') // '%'
 * extractUnitSuffix('2rem') // 'rem'
 * extractUnitSuffix('100') // 'px' (default)
 * extractUnitSuffix('auto') // 'px' (fallback)
 */
export function extractUnitSuffix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'px';

  // Handle shorthand values by taking first token
  const token = trimmed.split(/\s+/)[0] ?? '';

  // Match number + unit (including %)
  const match = token.match(/^-?(?:\d+|\d*\.\d+)([a-zA-Z%]+)$/);
  if (match) return match[1]!;

  // Pure number: default to px
  if (/^-?(?:\d+|\d*\.\d+)$/.test(token)) return 'px';
  if (/^-?\d+\.$/.test(token)) return 'px';

  return 'px';
}

/**
 * Check if a value has an explicit CSS unit.
 * Returns false for unitless numbers (e.g., "1.5" for line-height).
 *
 * @example
 * hasExplicitUnit('100px') // true
 * hasExplicitUnit('1.5') // false
 * hasExplicitUnit('auto') // false
 */
export function hasExplicitUnit(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const token = trimmed.split(/\s+/)[0] ?? '';
  return /^-?(?:\d+|\d*\.\d+)([a-zA-Z%]+)$/.test(token);
}

/**
 * Normalize a length value.
 * - Pure numbers (e.g., "100", "10.5") get "px" suffix
 * - Values with units or keywords pass through unchanged
 * - Empty string clears the inline style
 *
 * @example
 * normalizeLength('100') // '100px'
 * normalizeLength('10.5') // '10.5px'
 * normalizeLength('50%') // '50%'
 * normalizeLength('auto') // 'auto'
 * normalizeLength('') // ''
 */
export function normalizeLength(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Pure number patterns: "10", "-10", "10.5", ".5", "-.5"
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  // Trailing dot (e.g., "10.") -> treat as integer px
  if (/^-?\d+\.$/.test(trimmed)) {
    return `${trimmed.slice(0, -1)}px`;
  }

  // Keep units/keywords/expressions as-is
  return trimmed;
}
