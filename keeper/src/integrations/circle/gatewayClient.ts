import { assertGatewayForwarderEnabled } from './featureFlags';
import { GatewayProvider, GatewayTransferRequest, GatewayTransferResult } from './types';

export class GatewayClient {
  constructor(private readonly provider: GatewayProvider) {}

  async transfer(request: GatewayTransferRequest): Promise<GatewayTransferResult> {
    assertGatewayForwarderEnabled();

    if (Number(request.amount) <= 0) {
      throw new Error('Gateway transfer amount must be greater than zero.');
    }

    if (request.sourceDomain === request.destinationDomain) {
      throw new Error('Gateway transfer requires different source and destination domains.');
    }

    if (!request.destinationRecipient || request.destinationRecipient.trim().length === 0) {
      throw new Error('Gateway transfer requires destinationRecipient.');
    }

    return this.provider.transfer(request);
  }
}
