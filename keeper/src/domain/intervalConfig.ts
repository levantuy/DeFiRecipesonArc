/**
 * Shared check-interval helpers for recipe scheduling.
 * Single source of truth — imported by both recipeSyncApi and cronScheduler.
 */
import { RecipeType } from '../db/types';

export const MIN_CHECK_INTERVAL_HOURS = 1;
export const MAX_CHECK_INTERVAL_HOURS = 720;

export const DEFAULT_CHECK_INTERVAL_HOURS: Record<string, number> = {
  RECURRING_DCA: 24,
  AUTO_COMPOUNDER: 168,
};

/**
 * Parse and validate checkIntervalHours from an unknown runtime value.
 * Accepts number, numeric-string, or undefined (uses recipe-type default).
 * Throws on invalid or out-of-range values.
 */
export function parseCheckIntervalHours(
  rawValue: unknown,
  recipeType: RecipeType,
  context = ''
): number {
  const contextSuffix = context ? ` ${context}` : '';

  const value =
    rawValue === undefined
      ? (DEFAULT_CHECK_INTERVAL_HOURS[recipeType] ?? 24)
      : typeof rawValue === 'string'
        ? Number(rawValue.trim())
        : rawValue;

  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(
      `checkIntervalHours must be a whole number of hours.${contextSuffix}`
    );
  }

  if (value < MIN_CHECK_INTERVAL_HOURS || value > MAX_CHECK_INTERVAL_HOURS) {
    throw new Error(
      `checkIntervalHours must be between ${MIN_CHECK_INTERVAL_HOURS} and ${MAX_CHECK_INTERVAL_HOURS}.${contextSuffix}`
    );
  }

  return value;
}
