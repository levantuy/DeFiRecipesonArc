import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_CONFIG } from '../config/runtime';
import { GatewayClient } from '../integrations/circle/gatewayClient';
import { UnifiedBalanceClient } from '../integrations/circle/unifiedBalanceClient';

describe('Circle Integration Readiness Modules', () => {
  beforeEach(() => {
    RUNTIME_CONFIG.enableUnifiedBalance = false;
    RUNTIME_CONFIG.enableGatewayForwarder = false;
  });

  it('blocks unified balance operations when feature flag is disabled', async () => {
    const client = new UnifiedBalanceClient({
      getBalances: vi.fn(),
      spend: vi.fn(),
    });

    await expect(
      client.getBalances('0x1111111111111111111111111111111111111111')
    ).rejects.toThrow('Unified balance integration is disabled');
  });

  it('allows unified balance spend on happy path when feature flag is enabled', async () => {
    RUNTIME_CONFIG.enableUnifiedBalance = true;

    const spend = vi.fn().mockResolvedValue({
      transferId: 'transfer-1',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      explorerUrl: 'https://example.test/tx/transfer-1',
    });

    const client = new UnifiedBalanceClient({
      getBalances: vi.fn(),
      spend,
    });

    const result = await client.spend({
      amount: '10',
      sourceChain: 'Base_Sepolia',
      destinationChain: 'Arc_Testnet',
      recipientAddress: '0x1111111111111111111111111111111111111111',
    });

    expect(spend).toHaveBeenCalledTimes(1);
    expect(result.transferId).toBe('transfer-1');
  });

  it('blocks gateway transfers when feature flag is disabled', async () => {
    const client = new GatewayClient({
      transfer: vi.fn(),
    });

    await expect(
      client.transfer({
        amount: '5',
        sourceDomain: 6,
        destinationDomain: 26,
        destinationRecipient: '0x1111111111111111111111111111111111111111',
      })
    ).rejects.toThrow('Gateway forwarder integration is disabled');
  });

  it('rejects invalid gateway requests on failure path', async () => {
    RUNTIME_CONFIG.enableGatewayForwarder = true;

    const client = new GatewayClient({
      transfer: vi.fn(),
    });

    await expect(
      client.transfer({
        amount: '0',
        sourceDomain: 6,
        destinationDomain: 26,
        destinationRecipient: '0x1111111111111111111111111111111111111111',
      })
    ).rejects.toThrow('Gateway transfer amount must be greater than zero.');
  });
});
