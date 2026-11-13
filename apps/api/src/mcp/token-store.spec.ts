import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSilpoWriteTool, isCartScopedTool } from '@silpo/shared';
import { TokenStore } from './token-store.js';

describe('TokenStore', () => {
  let storePath: string;
  let store: TokenStore;

  beforeEach(() => {
    storePath = join(tmpdir(), `silpo-tokens-${Date.now()}-${Math.random()}.json`);
    process.env.MCP_TOKEN_STORE_PATH = storePath;
    store = new TokenStore();
  });

  afterEach(async () => {
    await fs.rm(storePath, { force: true });
    delete process.env.MCP_TOKEN_STORE_PATH;
  });

  it('isolates state between sessions', async () => {
    await store.update('session-a', { codeVerifier: 'verifier-a' });
    await store.update('session-b', { codeVerifier: 'verifier-b' });

    expect((await store.get('session-a')).codeVerifier).toBe('verifier-a');
    expect((await store.get('session-b')).codeVerifier).toBe('verifier-b');
    expect(await store.get('unknown-session')).toEqual({});
  });

  it('persists tokens to disk with owner-only permissions', async () => {
    await store.update('session-a', {
      tokens: { access_token: 'synthetic-token', token_type: 'Bearer' },
    });

    const stat = await fs.stat(storePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('clears only the requested scope', async () => {
    await store.update('session-a', {
      codeVerifier: 'verifier',
      tokens: { access_token: 'synthetic-token', token_type: 'Bearer' },
    });

    await store.clear('session-a', 'verifier');

    const state = await store.get('session-a');
    expect(state.codeVerifier).toBeUndefined();
    expect(state.tokens?.access_token).toBe('synthetic-token');
  });

  it('resolves a session from its OAuth state parameter', async () => {
    await store.update('session-a', { oauthState: 'state-xyz' });

    expect(await store.findBySessionState('state-xyz')).toBe('session-a');
    expect(await store.findBySessionState('state-nope')).toBeUndefined();
  });
});

describe('Silpo tool classification', () => {
  it('flags state-changing tools so the agent asks for approval', () => {
    expect(isSilpoWriteTool('silpo_add_or_update_cart_products')).toBe(true);
    expect(isSilpoWriteTool('silpo_clear_shopping_cart')).toBe(true);
    expect(isSilpoWriteTool('silpo_get_my_shopping_cart')).toBe(false);
  });

  it('fails closed: unknown or new tools count as writes', () => {
    // Address writes were missing from the old denylist; future tools too.
    expect(isSilpoWriteTool('silpo_add_or_update_addresses')).toBe(true);
    expect(isSilpoWriteTool('silpo_delete_address')).toBe(true);
    expect(isSilpoWriteTool('some_other_tool')).toBe(true);
    expect(isSilpoWriteTool('silpo_get_')).toBe(true);
    for (const read of [
      'silpo_get_my_coupons',
      'silpo_find_products_batch',
      'silpo_get_time_slots',
    ]) {
      expect(isSilpoWriteTool(read)).toBe(false);
    }
  });

  it('flags tools that need cart context resolved first', () => {
    expect(isCartScopedTool('silpo_find_products_batch')).toBe(true);
    expect(isCartScopedTool('silpo_get_my_profile')).toBe(false);
  });
});
