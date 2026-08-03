require('dotenv/config');

const DEFAULT_BASE_URL = 'http://localhost:8787';
const DEFAULT_USER_ADDRESS = '0x1111111111111111111111111111111111111111';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = text.length ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON response from ${url}. status=${response.status} body=${text}`);
  }

  if (!response.ok) {
    throw new Error(`Request failed ${url}. status=${response.status} body=${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  const baseUrl = (process.env.KEEPER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const userAddress = (process.env.SMOKE_USER_ADDRESS || DEFAULT_USER_ADDRESS).toLowerCase();
  const logLimit = Number(process.env.SMOKE_LOG_LIMIT || '5');

  console.log(`[smoke] baseUrl=${baseUrl}`);
  console.log(`[smoke] userAddress=${userAddress}`);

  const health = await httpJson(`${baseUrl}/healthz`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  assert(isObject(health), 'healthz response must be an object');
  assert(health.status === 'ok', 'healthz.status must be ok');
  assert(typeof health.service === 'string', 'healthz.service must be a string');
  assert(health.chainId !== undefined, 'healthz.chainId must exist');

  const registerPayload = {
    userAddress,
    recipeType: 'RECURRING_DCA',
    swapProvider: 'ARC_APP_KIT_SWAP',
    parametersJson: {
      maxSlippageBps: 100,
      dcaAmountUsdc: '50',
    },
  };

  const register = await httpJson(`${baseUrl}/recipes/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(registerPayload),
  });

  assert(isObject(register), 'register response must be an object');
  assert(register.success === true, 'register.success must be true');
  assert(register.operation === 'created' || register.operation === 'updated', 'register.operation must be created or updated');
  assert(isObject(register.recipe), 'register.recipe must be an object');
  assert(typeof register.recipe.id === 'string', 'register.recipe.id must be a string');
  assert(register.recipe.userAddress === userAddress, 'register.recipe.userAddress mismatch');
  assert(register.recipe.recipeType === 'RECURRING_DCA', 'register.recipe.recipeType mismatch');

  const statusPayload = {
    userAddress,
    recipeType: 'RECURRING_DCA',
    status: 'PAUSED',
  };

  const status = await httpJson(`${baseUrl}/recipes/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(statusPayload),
  });

  assert(isObject(status), 'status response must be an object');
  assert(status.success === true, 'status.success must be true');
  assert(isObject(status.recipe), 'status.recipe must be an object');
  assert(status.recipe.status === 'PAUSED', 'status.recipe.status must be PAUSED');

  const logs = await httpJson(
    `${baseUrl}/recipes/logs?userAddress=${encodeURIComponent(userAddress)}&limit=${encodeURIComponent(String(logLimit))}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  );

  assert(isObject(logs), 'logs response must be an object');
  assert(logs.success === true, 'logs.success must be true');
  assert(Array.isArray(logs.logs), 'logs.logs must be an array');

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checks: {
          healthz: true,
          register: true,
          status: true,
          logs: true,
        },
        sample: {
          registerOperation: register.operation,
          recipeId: register.recipe.id,
          currentStatus: status.recipe.status,
          logsCount: logs.logs.length,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error.message}`);
  process.exit(1);
});
