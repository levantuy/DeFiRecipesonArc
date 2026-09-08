/**
 * Whitelists the Circle App Kit swap adapter contract in RecipeGuardrail so that
 * RECURRING_DCA recipes can execute `execute(ExecutionParams,TokenInput[],bytes)`
 * through SharedExecutorProxy. Must be run with the RecipeGuardrail owner key.
 */
require('dotenv').config();

const { createPublicClient, createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { arcTestnet } = require('viem/chains');

const ADAPTER_ADDRESS = '0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b';
const ADAPTER_EXECUTE_SELECTOR = '0xaa3e079c';

const GUARDRAIL_ABI = [
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isProtocolWhitelisted',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSelectorAllowed',
    inputs: [{ type: 'address' }, { type: 'bytes4' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'configureProtocolAndSelectors',
    inputs: [
      { name: 'protocol', type: 'address' },
      { name: 'protocolAllowed', type: 'bool' },
      { name: 'selectors', type: 'bytes4[]' },
      { name: 'selectorsAllowed', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

async function main() {
  const rpcUrl = process.env.ARC_TESTNET_RPC_URL;
  const guardrail = process.env.RECIPE_GUARDRAIL_ADDRESS;
  const privateKey = process.env.KEEPER_PRIVATE_KEY;

  if (!rpcUrl || !guardrail || !privateKey) {
    throw new Error('ARC_TESTNET_RPC_URL, RECIPE_GUARDRAIL_ADDRESS and KEEPER_PRIVATE_KEY are required.');
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) });

  const owner = await publicClient.readContract({
    address: guardrail,
    abi: GUARDRAIL_ABI,
    functionName: 'owner',
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`KEEPER_PRIVATE_KEY (${account.address}) is not the RecipeGuardrail owner (${owner}).`);
  }

  const alreadyAllowed = await publicClient.readContract({
    address: guardrail,
    abi: GUARDRAIL_ABI,
    functionName: 'isSelectorAllowed',
    args: [ADAPTER_ADDRESS, ADAPTER_EXECUTE_SELECTOR],
  });

  if (alreadyAllowed) {
    console.log(`Already configured: ${ADAPTER_ADDRESS} ${ADAPTER_EXECUTE_SELECTOR}`);
    return;
  }

  const hash = await walletClient.writeContract({
    address: guardrail,
    abi: GUARDRAIL_ABI,
    functionName: 'configureProtocolAndSelectors',
    args: [ADAPTER_ADDRESS, true, [ADAPTER_EXECUTE_SELECTOR], true],
  });

  console.log(`configureProtocolAndSelectors tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`status: ${receipt.status}`);
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exit(1);
});
