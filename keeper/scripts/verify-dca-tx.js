require('dotenv/config');

const DEFAULT_RPC_URL = process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network';
const DEFAULT_PROXY_ADDRESS =
  process.env.SHARED_EXECUTOR_PROXY_ADDRESS || '0x61B5bCF16569DC584a05049563b0A2842122BEA4';
const DEFAULT_USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const DEFAULT_CIRBTC_ADDRESS = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF';

function parseArg(name) {
  const index = process.argv.findIndex((value) => value === `--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1];
}

function parseBoolean(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function toLowerAddress(value) {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value.trim())) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value.trim().toLowerCase();
}

function toHash(value) {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(value.trim())) {
    throw new Error(`Invalid transaction hash: ${value}`);
  }
  return value.trim();
}

function formatDelta(raw, decimals, formatUnits) {
  return {
    raw: raw.toString(),
    formatted: formatUnits(raw, decimals),
  };
}

function normalizeJsonValue(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(entry);
    }
    return normalized;
  }

  return value;
}

async function readErc20BalanceAt(client, tokenAddress, ownerAddress, blockNumber) {
  const abi = [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{ name: 'owner', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
  ];

  return client.readContract({
    address: tokenAddress,
    abi,
    functionName: 'balanceOf',
    args: [ownerAddress],
    blockNumber,
  });
}

async function main() {
  const txHash = toHash(parseArg('tx') || process.env.DCA_TX_HASH || '');
  const userAddress = toLowerAddress(parseArg('user') || process.env.DCA_USER_ADDRESS || '');
  const proxyAddress = toLowerAddress(parseArg('proxy') || process.env.DCA_PROXY_ADDRESS || DEFAULT_PROXY_ADDRESS);
  const usdcAddress = toLowerAddress(parseArg('usdc') || process.env.DCA_USDC_ADDRESS || DEFAULT_USDC_ADDRESS);
  const outputTokenAddress = toLowerAddress(
    parseArg('output-token') || process.env.DCA_OUTPUT_TOKEN_ADDRESS || DEFAULT_CIRBTC_ADDRESS
  );

  const rpcUrl = parseArg('rpc') || process.env.DCA_RPC_URL || DEFAULT_RPC_URL;
  const usdcDecimals = Number(parseArg('usdc-decimals') || process.env.DCA_USDC_DECIMALS || '6');
  const outputDecimals = Number(parseArg('output-decimals') || process.env.DCA_OUTPUT_DECIMALS || '8');
  const expectSweepEvent = parseBoolean(
    parseArg('expect-sweep-event') || process.env.DCA_EXPECT_SWEEP_EVENT,
    false
  );

  const { createPublicClient, decodeEventLog, formatUnits, http, parseAbiItem } = await import('viem');
  const { arcTestnet } = await import('viem/chains');

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }),
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const prevBlockNumber = receipt.blockNumber > 0n ? receipt.blockNumber - 1n : receipt.blockNumber;

  const [
    userUsdcBefore,
    userUsdcAfter,
    proxyUsdcBefore,
    proxyUsdcAfter,
    userOutBefore,
    userOutAfter,
    proxyOutBefore,
    proxyOutAfter,
  ] = await Promise.all([
    readErc20BalanceAt(client, usdcAddress, userAddress, prevBlockNumber),
    readErc20BalanceAt(client, usdcAddress, userAddress, receipt.blockNumber),
    readErc20BalanceAt(client, usdcAddress, proxyAddress, prevBlockNumber),
    readErc20BalanceAt(client, usdcAddress, proxyAddress, receipt.blockNumber),
    readErc20BalanceAt(client, outputTokenAddress, userAddress, prevBlockNumber),
    readErc20BalanceAt(client, outputTokenAddress, userAddress, receipt.blockNumber),
    readErc20BalanceAt(client, outputTokenAddress, proxyAddress, prevBlockNumber),
    readErc20BalanceAt(client, outputTokenAddress, proxyAddress, receipt.blockNumber),
  ]);

  const recipeEvent = parseAbiItem(
    'event RecipeStepExecuted(address indexed user,address indexed keeper,address indexed targetProtocol,bytes4 selector,uint256 minAmountOut)'
  );
  const sweepEvent = parseAbiItem(
    'event SwapOutputSwept(address indexed user,address indexed outputToken,uint256 amount,address indexed targetProtocol)'
  );

  const decodedEvents = [];
  for (const log of receipt.logs) {
    if (!log.address || String(log.address).toLowerCase() !== proxyAddress) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [recipeEvent, sweepEvent],
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      decodedEvents.push(decoded);
    } catch {
      // Ignore unrelated logs from the proxy address.
    }
  }

  const recipeEvents = decodedEvents.filter((event) => event.eventName === 'RecipeStepExecuted');
  const sweepEvents = decodedEvents.filter((event) => event.eventName === 'SwapOutputSwept');

  const hasRecipeSwapEvent = recipeEvents.some((event) => {
    const args = event.args || {};
    const eventUser = args.user ? String(args.user).toLowerCase() : '';
    const selector = args.selector ? String(args.selector).toLowerCase() : '';
    return (
      eventUser === userAddress &&
      (selector === '0x7ebc46f0' || selector === '0x38ed1739')
    );
  });

  const hasSweepEventForUser = sweepEvents.some((event) => {
    const args = event.args || {};
    const eventUser = args.user ? String(args.user).toLowerCase() : '';
    const eventToken = args.outputToken ? String(args.outputToken).toLowerCase() : '';
    const eventAmount = args.amount ? BigInt(args.amount) : 0n;
    return eventUser === userAddress && eventToken === outputTokenAddress && eventAmount > 0n;
  });

  const userUsdcDelta = userUsdcAfter - userUsdcBefore;
  const proxyUsdcDelta = proxyUsdcAfter - proxyUsdcBefore;
  const userOutputDelta = userOutAfter - userOutBefore;
  const proxyOutputDelta = proxyOutAfter - proxyOutBefore;

  const checks = {
    receiptSuccess: receipt.status === 'success',
    hasRecipeSwapEvent,
    hasSweepEventForUser,
    userReceivedOutputToken: userOutputDelta > 0n,
    proxyDidNotAccumulateOutputToken: proxyOutputDelta <= 0n,
    expectedSweepEventSatisfied: !expectSweepEvent || hasSweepEventForUser,
  };

  const summary = {
    txHash,
    rpcUrl,
    blockNumber: receipt.blockNumber.toString(),
    prevBlockNumber: prevBlockNumber.toString(),
    addresses: {
      userAddress,
      proxyAddress,
      usdcAddress,
      outputTokenAddress,
    },
    receiptStatus: receipt.status,
    events: {
      recipeStepExecutedCount: recipeEvents.length,
      swapOutputSweptCount: sweepEvents.length,
      decodedProxyEvents: decodedEvents.map((event) => ({
        eventName: event.eventName,
        args: normalizeJsonValue(event.args),
      })),
    },
    deltas: {
      userUsdc: formatDelta(userUsdcDelta, usdcDecimals, formatUnits),
      proxyUsdc: formatDelta(proxyUsdcDelta, usdcDecimals, formatUnits),
      userOutputToken: formatDelta(userOutputDelta, outputDecimals, formatUnits),
      proxyOutputToken: formatDelta(proxyOutputDelta, outputDecimals, formatUnits),
    },
    checks,
    verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.verdict !== 'PASS') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(`[verify-dca-tx] ${error.message}`);
  console.error(
    'Usage: node scripts/verify-dca-tx.js --tx <0xhash> --user <0xuser> [--proxy <0xproxy>] [--output-token <0xtoken>]'
  );
  process.exit(1);
});
