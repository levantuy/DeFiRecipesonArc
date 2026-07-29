export const ARC_TESTNET_CHAIN_ID = 5042002;

export const CONTRACT_ADDRESSES = {
  sessionKeyRegistry: (process.env.NEXT_PUBLIC_SESSION_KEY_REGISTRY_ADDRESS ||
    '0x6d588749fef454ad088aee53d78cc020238a7d13') as `0x${string}`,
  recipeGuardrail: (process.env.NEXT_PUBLIC_RECIPE_GUARDRAIL_ADDRESS ||
    '0xcf0dc13ab3d1efd2eac8baf47639f45b205ad824') as `0x${string}`,
  sharedExecutorProxy: (process.env.NEXT_PUBLIC_SHARED_EXECUTOR_PROXY_ADDRESS ||
    '0xcbd2de404cb02c45b8688883e4321f887a6f2fc2') as `0x${string}`,
  usdc: '0x3600000000000000000000000000000000000000' as `0x${string}`,
};

export const SESSION_KEY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSessionPermission',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'sessionKey', type: 'address', internalType: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct SessionKeyRegistry.SessionPermission',
        components: [
          { name: 'sessionKey', type: 'address', internalType: 'address' },
          { name: 'validUntil', type: 'uint64', internalType: 'uint64' },
          { name: 'maxUsdcSpendLimit', type: 'uint256', internalType: 'uint256' },
          { name: 'currentUsdcSpent', type: 'uint256', internalType: 'uint256' },
          { name: 'revoked', type: 'bool', internalType: 'bool' },
          { name: 'exists', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isValidSessionKey',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'sessionKey', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'registerSessionKey',
    inputs: [
      { name: 'sessionKey', type: 'address', internalType: 'address' },
      { name: 'validUntil', type: 'uint64', internalType: 'uint64' },
      { name: 'maxUsdcSpendLimit', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeSessionKey',
    inputs: [{ name: 'sessionKey', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'SessionKeyRegistered',
    inputs: [
      { name: 'user', type: 'address', indexed: true, internalType: 'address' },
      { name: 'sessionKey', type: 'address', indexed: true, internalType: 'address' },
      { name: 'validUntil', type: 'uint64', indexed: false, internalType: 'uint64' },
      { name: 'maxUsdcSpendLimit', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SessionKeyRevoked',
    inputs: [
      { name: 'user', type: 'address', indexed: true, internalType: 'address' },
      { name: 'sessionKey', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
] as const;

export const RECIPE_GUARDRAIL_ABI = [
  {
    type: 'function',
    name: 'isProtocolWhitelisted',
    inputs: [{ name: 'protocol', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isSelectorAllowed',
    inputs: [
      { name: 'protocol', type: 'address', internalType: 'address' },
      { name: 'selector', type: 'bytes4', internalType: 'bytes4' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'validateCall',
    inputs: [
      { name: 'targetProtocol', type: 'address', internalType: 'address' },
      { name: 'selector', type: 'bytes4', internalType: 'bytes4' },
    ],
    outputs: [],
    stateMutability: 'view',
  },
] as const;

export const SHARED_EXECUTOR_PROXY_ABI = [
  {
    type: 'function',
    name: 'executeRecipeStep',
    inputs: [
      { name: 'user', type: 'address', internalType: 'address' },
      { name: 'targetProtocol', type: 'address', internalType: 'address' },
      { name: 'callData', type: 'bytes', internalType: 'bytes' },
      { name: 'minAmountOut', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isUserPaused',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pauseMyRecipes',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unpauseMyRecipes',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sessionKeyRegistry',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'guardrail',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'RecipeStepExecuted',
    inputs: [
      { name: 'user', type: 'address', indexed: true, internalType: 'address' },
      { name: 'keeper', type: 'address', indexed: true, internalType: 'address' },
      { name: 'targetProtocol', type: 'address', indexed: true, internalType: 'address' },
      { name: 'selector', type: 'bytes4', indexed: false, internalType: 'bytes4' },
      { name: 'minAmountOut', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const;
