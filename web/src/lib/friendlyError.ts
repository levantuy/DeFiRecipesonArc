/**
 * Maps raw wallet / RPC / App Kit errors to short, actionable user-facing
 * messages. Never surfaces internal stack traces or hex revert data.
 */
export function friendlyError(error: unknown, fallback?: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const low = raw.toLowerCase();

  // ── Wallet locked ────────────────────────────────────────────────────────
  if (
    low.includes('keyringcontroller') ||
    low.includes('controller is locked') ||
    low.includes('wallet is locked') ||
    low.includes('the operation cannot be completed while')
  ) {
    return 'Your wallet is locked. Please unlock MetaMask and try again.';
  }

  // ── User rejected ────────────────────────────────────────────────────────
  if (
    low.includes('user rejected') ||
    low.includes('user denied') ||
    low.includes('rejected the request') ||
    low.includes('action_rejected') ||
    low.includes('eth_requestaccounts') // user closed connect modal
  ) {
    return 'Transaction cancelled.';
  }

  // ── Wrong network ────────────────────────────────────────────────────────
  if (
    low.includes('wrong network') ||
    low.includes('unsupported chain') ||
    low.includes('chain mismatch') ||
    low.includes('switch network')
  ) {
    return 'Wrong network. Please switch to Arc Testnet (Chain ID 5042002) and try again.';
  }

  // ── Insufficient balance ─────────────────────────────────────────────────
  if (
    low.includes('insufficient funds') ||
    low.includes('insufficient balance') ||
    low.includes('exceeds balance') ||
    low.includes('transfer amount exceeds')
  ) {
    return 'Insufficient balance to complete this transaction.';
  }

  // ── Slippage / price impact ──────────────────────────────────────────────
  if (
    low.includes('slippage') ||
    low.includes('price impact') ||
    low.includes('min amount') ||
    low.includes('minimum amount') ||
    low.includes('too much slippage') ||
    low.includes('exceeds limit')
  ) {
    return 'Transaction failed: price moved beyond slippage limit. Try increasing slippage tolerance or reducing the amount.';
  }

  // ── Gas / execution reverts ──────────────────────────────────────────────
  if (
    low.includes('out of gas') ||
    low.includes('gas required exceeds') ||
    low.includes('gas limit')
  ) {
    return 'Transaction ran out of gas. Please try again with a higher gas limit.';
  }

  if (
    low.includes('execution reverted') ||
    low.includes('revert') ||
    low.includes('vm exception')
  ) {
    // Try to extract a revert reason from the message
    const reasonMatch = raw.match(/reason:\s*"?([^"'\n]{1,80})"?/i) ||
                        raw.match(/reverted with reason string '([^']{1,80})'/i) ||
                        raw.match(/reverted:\s*([^\n]{1,80})/i);
    if (reasonMatch?.[1]) {
      return `Transaction reverted: ${reasonMatch[1].trim()}`;
    }
    return 'Transaction reverted by the contract. Please check your inputs and try again.';
  }

  // ── Network / connectivity ────────────────────────────────────────────────
  if (
    low.includes('network error') ||
    low.includes('fetch failed') ||
    low.includes('failed to fetch') ||
    low.includes('socket hang up') ||
    low.includes('etimedout') ||
    low.includes('econnrefused') ||
    low.includes('timeout')
  ) {
    return 'Network error. Please check your connection and try again.';
  }

  // ── Internal wallet error (generic) ──────────────────────────────────────
  if (
    low.includes('internal error') ||
    low.includes('an internal error was received') ||
    low.includes('jsonrpc error')
  ) {
    return 'Wallet returned an internal error. Please unlock your wallet, disconnect, reconnect, and try again.';
  }

  // ── Allowance / approval ─────────────────────────────────────────────────
  if (
    low.includes('allowance') ||
    low.includes('approve') ||
    low.includes('erc20: transfer amount exceeds allowance')
  ) {
    return 'Insufficient token allowance. Please approve the required amount and try again.';
  }

  // ── Session key / delegation ──────────────────────────────────────────────
  if (
    low.includes('session key') ||
    low.includes('delegation') ||
    low.includes('permission denied') ||
    low.includes('not authorized') ||
    low.includes('spend limit')
  ) {
    return 'Session key error. Your delegation may have expired or the spend limit was reached. Please re-activate the recipe.';
  }

  // ── Fallback: trim raw message to max 140 chars ───────────────────────────
  if (fallback) return fallback;
  return raw.length > 140 ? raw.slice(0, 137) + '…' : raw || 'An unexpected error occurred. Please try again.';
}
