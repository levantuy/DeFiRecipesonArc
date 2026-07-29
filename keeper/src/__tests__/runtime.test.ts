import { describe, expect, it } from 'vitest';
import { isValidPrivateKey } from '../config/runtime';

describe('Runtime Config Helpers', () => {
  it('accepts a valid hex private key format', () => {
    const validKey = `0x${'a'.repeat(64)}`;
    expect(isValidPrivateKey(validKey)).toBe(true);
  });

  it('rejects invalid private key formats', () => {
    expect(isValidPrivateKey('')).toBe(false);
    expect(isValidPrivateKey('0x1234')).toBe(false);
    expect(isValidPrivateKey(`0x${'g'.repeat(64)}`)).toBe(false);
  });
});