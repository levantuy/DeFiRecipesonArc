require('dotenv/config');

const DEFAULT_BASE_URL = (process.env.KEEPER_BASE_URL || 'http://localhost:8787').replace(/\/$/, '');
const DEFAULT_USER_ADDRESS = process.env.DCA_USER_ADDRESS || '0xfd710eeb8fe08942f14fae4d0c35d5e02686055a';
const DEFAULT_TOTAL_BUDGET_USDC = process.env.DCA_TOTAL_BUDGET_USDC || '2';

const DEFAULT_AMOUNTS = ['0.05', '0.1', '0.2', '0.5', '1'];
const DEFAULT_SLIPPAGES = [100, 200, 500, 1000];
const DEFAULT_TARGETS = ['cirBTC', 'EURC'];

function parseArg(name) {
  const index = process.argv.findIndex((item) => item === `--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[index + 1];
}

function parseList(value, fallback) {
  if (!value || !value.trim()) {
    return fallback;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseIntList(value, fallback) {
  const list = parseList(value, fallback.map(String));
  return list.map((item) => {
    const parsed = Number(item);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid integer in list: ${item}`);
    }
    return parsed;
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const err = data && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`;
    throw new Error(err);
  }

  return data;
}

async function probeOne({ baseUrl, userAddress, totalBudgetUsdc, perExecutionAmountUsdc, maxSlippageBps, targetAssetSymbol }) {
  const payload = {
    userAddress,
    totalBudgetUsdc,
    perExecutionAmountUsdc,
    maxSlippageBps,
    targetAssetSymbol,
  };

  try {
    const response = await postJson(`${baseUrl}/recipes/dca/allowance-precheck`, payload);
    const allowance = response.allowance || {};
    return {
      ok: true,
      targetAssetSymbol,
      perExecutionAmountUsdc,
      maxSlippageBps,
      targetProtocolAddress: allowance.targetProtocolAddress || null,
      runtimeSpender: allowance.runtimeSpender || null,
      selector: allowance.callDataSelector || null,
      isEnoughForScheduler: allowance.isEnoughForScheduler === true,
      isEnoughForActivation: allowance.isEnoughForActivation === true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      targetAssetSymbol,
      perExecutionAmountUsdc,
      maxSlippageBps,
      targetProtocolAddress: null,
      runtimeSpender: null,
      selector: null,
      isEnoughForScheduler: false,
      isEnoughForActivation: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function maybeActivateFirstWorkingRoute({ baseUrl, userAddress, totalBudgetUsdc, rows }) {
  const firstWorking = rows.find((row) => row.ok && row.targetAssetSymbol.toLowerCase() === 'cirbtc');
  if (!firstWorking) {
    return null;
  }

  const payload = {
    userAddress,
    recipeType: 'RECURRING_DCA',
    swapProvider: 'ARC_APP_KIT_SWAP',
    parametersJson: {
      totalBudgetUsdc,
      perExecutionAmountUsdc: firstWorking.perExecutionAmountUsdc,
      mode: 'PULL',
      maxSlippageBps: firstWorking.maxSlippageBps,
      targetAssetSymbol: firstWorking.targetAssetSymbol,
      checkIntervalHours: 1,
      spentAmountBaseUnits: '0',
      executedCount: 0,
      status: 'ACTIVE',
    },
  };

  const response = await postJson(`${baseUrl}/recipes/register`, payload);
  return {
    selected: {
      targetAssetSymbol: firstWorking.targetAssetSymbol,
      perExecutionAmountUsdc: firstWorking.perExecutionAmountUsdc,
      maxSlippageBps: firstWorking.maxSlippageBps,
      targetProtocolAddress: firstWorking.targetProtocolAddress,
      runtimeSpender: firstWorking.runtimeSpender,
    },
    registerResponse: response,
  };
}

async function main() {
  const baseUrl = (parseArg('base-url') || process.env.KEEPER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const userAddress = (parseArg('user') || process.env.DCA_USER_ADDRESS || DEFAULT_USER_ADDRESS).toLowerCase();
  const totalBudgetUsdc = parseArg('total-budget') || process.env.DCA_TOTAL_BUDGET_USDC || DEFAULT_TOTAL_BUDGET_USDC;
  const amounts = parseList(parseArg('amounts') || process.env.DCA_PROBE_AMOUNTS, DEFAULT_AMOUNTS);
  const slippages = parseIntList(parseArg('slippages') || process.env.DCA_PROBE_SLIPPAGES, DEFAULT_SLIPPAGES);
  const targets = parseList(parseArg('targets') || process.env.DCA_PROBE_TARGETS, DEFAULT_TARGETS);
  const activateBest = ['1', 'true', 'yes', 'on'].includes((parseArg('activate-best') || '').toLowerCase());

  const rows = [];
  for (const targetAssetSymbol of targets) {
    for (const perExecutionAmountUsdc of amounts) {
      for (const maxSlippageBps of slippages) {
        // Sequential probing keeps API load small and logs easier to correlate.
        const row = await probeOne({
          baseUrl,
          userAddress,
          totalBudgetUsdc,
          perExecutionAmountUsdc,
          maxSlippageBps,
          targetAssetSymbol,
        });
        rows.push(row);
      }
    }
  }

  const summary = {
    baseUrl,
    userAddress,
    totalBudgetUsdc,
    attempted: rows.length,
    successCount: rows.filter((row) => row.ok).length,
    failureCount: rows.filter((row) => !row.ok).length,
    cirbtcSuccessCount: rows.filter((row) => row.ok && row.targetAssetSymbol.toLowerCase() === 'cirbtc').length,
    eurcSuccessCount: rows.filter((row) => row.ok && row.targetAssetSymbol.toLowerCase() === 'eurc').length,
    rows,
  };

  if (activateBest) {
    summary.activation = await maybeActivateFirstWorkingRoute({
      baseUrl,
      userAddress,
      totalBudgetUsdc,
      rows,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`[probe-dca-routes] ${error.message}`);
  process.exit(1);
});
