import { describe, it, expect } from 'vitest';
import {
  ARC_TESTNET_CONFIG,
  CONTRACT_ADDRESSES,
  SESSION_KEY_REGISTRY_ABI,
  RECIPE_GUARDRAIL_ABI,
  SHARED_EXECUTOR_PROXY_ABI,
} from '../config/contracts';

describe('Contracts Configuration', () => {
  it('should have valid Arc Testnet chain configuration', () => {
    expect(ARC_TESTNET_CONFIG.chainId).toBe(5042002);
    expect(ARC_TESTNET_CONFIG.chainName).toBe('Arc Testnet');
    expect(ARC_TESTNET_CONFIG.rpcUrl).toBeDefined();
    expect(ARC_TESTNET_CONFIG.usdcAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('should have valid contract addresses defined', () => {
    expect(CONTRACT_ADDRESSES.sessionKeyRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(CONTRACT_ADDRESSES.recipeGuardrail).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(CONTRACT_ADDRESSES.sharedExecutorProxy).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('should contain expected ABI definitions', () => {
    expect(SESSION_KEY_REGISTRY_ABI).toBeDefined();
    expect(RECIPE_GUARDRAIL_ABI).toBeDefined();
    expect(SHARED_EXECUTOR_PROXY_ABI).toBeDefined();

    const sessionKeyFunctions = SESSION_KEY_REGISTRY_ABI.map((item: any) => item.name);
    expect(sessionKeyFunctions).toContain('getSessionPermission');
    expect(sessionKeyFunctions).toContain('isValidSessionKey');
    expect(sessionKeyFunctions).toContain('registerSessionKey');

    const executorFunctions = SHARED_EXECUTOR_PROXY_ABI.map((item: any) => item.name);
    expect(executorFunctions).toContain('executeRecipeStep');
  });
});
