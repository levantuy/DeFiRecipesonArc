import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/activeRecipeCount.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { countActiveRecipes, fetchActiveRecipeCount } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const wallet = '0x11111111111111111111111111111111111111aa';
const now = Date.parse('2026-10-22T10:00:00Z');
const recipe = (id, overrides = {}) => ({
  id,
  userAddress: wallet,
  status: 'ACTIVE',
  delegationValidUntil: '2026-10-23T10:00:00Z',
  ...overrides,
});

test('counts unique active, unexpired subscriptions for the connected wallet only', () => {
  const recipes = [
    recipe('active'),
    recipe('active'),
    recipe('second', { userAddress: wallet.toUpperCase() }),
    recipe('paused', { status: 'PAUSED' }),
    recipe('cancelled', { status: 'CANCELLED' }),
    recipe('completed', { status: 'COMPLETED' }),
    recipe('other-wallet', { userAddress: '0x2222222222222222222222222222222222222222' }),
    recipe('expired', { delegationValidUntil: '2026-10-21T10:00:00Z' }),
    recipe('expires-now', { delegationValidUntil: '2026-10-22T10:00:00Z' }),
    recipe('missing-expiry', { delegationValidUntil: null }),
    recipe('invalid-expiry', { delegationValidUntil: 'invalid' }),
  ];
  assert.equal(countActiveRecipes(recipes, wallet, now), 2);
  assert.equal(countActiveRecipes([], wallet, now), 0);
});

test('the count is independent of execution history and drops when authorization expires', () => {
  const recipes = Array.from({ length: 12 }, (_, index) => recipe(String(index)));
  assert.equal(countActiveRecipes(recipes, wallet, now), 12);
  assert.equal(countActiveRecipes(recipes, wallet, Date.parse('2026-10-23T10:00:00Z')), 0);
});

test('fetches wallet-scoped recipes, supports cancellation, and rejects unreliable totals', async (t) => {
  const controller = new AbortController();
  let body = { success: true, dataSource: 'keeper-db', recipes: [] };
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.pathname, '/api/recipes');
    assert.equal(parsed.searchParams.get('userAddress'), wallet);
    assert.equal(parsed.searchParams.get('limit'), '200');
    assert.equal(parsed.searchParams.has('offset'), false);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal, controller.signal);
    return Response.json(body, { status });
  });

  const fetchCount = () => fetchActiveRecipeCount(wallet.toUpperCase(), controller.signal);
  assert.equal(await fetchCount(), 0);
  body = { ...body, recipes: [recipe('live', { delegationValidUntil: '2099-01-01T00:00:00Z' })] };
  assert.equal(await fetchCount(), 1);
  body = { ...body, dataSource: 'memory-fallback' };
  await assert.rejects(fetchCount, /keeper data could not be loaded/);
  body = { ...body, dataSource: 'keeper-db', recipes: Array.from({ length: 200 }, (_, i) => recipe(String(i))) };
  await assert.rejects(fetchCount, /list limit was reached/);
  body = { success: false, error: 'Keeper unavailable' };
  status = 503;
  await assert.rejects(fetchCount, /Keeper unavailable/);
  body = { success: true, dataSource: 'keeper-db', recipes: null };
  status = 200;
  await assert.rejects(fetchCount, /Failed to load active recipes/);
});
