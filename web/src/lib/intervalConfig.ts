export const MIN_INTERVAL_HOURS = 1;
export const MAX_INTERVAL_HOURS = 720;

export function parseIntervalHours(value: unknown, fieldName = 'Interval Hours'): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${fieldName} is required.`);
  }

  const normalized = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || !Number.isInteger(normalized)) {
    throw new Error(`${fieldName} must be a whole number of hours.`);
  }

  if (normalized < MIN_INTERVAL_HOURS || normalized > MAX_INTERVAL_HOURS) {
    throw new Error(`${fieldName} must be between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS} hours.`);
  }

  return normalized;
}