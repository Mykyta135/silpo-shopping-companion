import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Per-session OAuth state for the Silpo MCP server.
 *
 * SECURITY: tokens live only on the server. The mobile client holds an opaque
 * sessionId and never receives an MCP token — this is a hard requirement of the
 * hackathon rules ("зберігати токени серверно, а не в клієнтському коді").
 */
export interface SessionAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  /** OAuth `state` param, used to bind the callback to this session. */
  oauthState?: string;
}

/**
 * File-backed store, adequate for a hackathon demo on a single instance.
 *
 * For production, swap the persistence methods for encrypted rows in Postgres
 * or a secrets manager — the interface is deliberately narrow to make that easy.
 * The backing file is gitignored (.mcp-tokens.json) and written with mode 0600.
 */
@Injectable()
export class TokenStore {
  private readonly logger = new Logger(TokenStore.name);
  private readonly filePath = resolve(
    process.env.MCP_TOKEN_STORE_PATH ?? '.mcp-tokens.json',
  );
  private cache = new Map<string, SessionAuthState>();
  private loaded = false;
  /** Serialises read-modify-write cycles so concurrent sessions can't clobber the file. */
  private writeChain: Promise<void> = Promise.resolve();

  async get(sessionId: string): Promise<SessionAuthState> {
    await this.load();
    return this.cache.get(sessionId) ?? {};
  }

  async update(
    sessionId: string,
    patch: Partial<SessionAuthState>,
  ): Promise<void> {
    await this.load();
    const next = { ...(this.cache.get(sessionId) ?? {}), ...patch };
    this.cache.set(sessionId, next);
    await this.persist();
  }

  async clear(
    sessionId: string,
    scope: 'all' | 'client' | 'tokens' | 'verifier' = 'all',
  ): Promise<void> {
    await this.load();
    if (scope === 'all') {
      this.cache.delete(sessionId);
    } else {
      const current = this.cache.get(sessionId);
      if (!current) return;
      if (scope === 'client') delete current.clientInformation;
      if (scope === 'tokens') delete current.tokens;
      if (scope === 'verifier') delete current.codeVerifier;
      this.cache.set(sessionId, current);
    }
    await this.persist();
  }

  /** Finds the session that initiated an OAuth flow with the given `state`. */
  async findBySessionState(oauthState: string): Promise<string | undefined> {
    await this.load();
    for (const [sessionId, state] of this.cache) {
      if (state.oauthState && state.oauthState === oauthState) return sessionId;
    }
    return undefined;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = new Map(Object.entries(JSON.parse(raw) as Record<string, SessionAuthState>));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not read token store: ${(err as Error).message}`);
      }
      this.cache = new Map();
    }
    this.loaded = true;
  }

  private persist(): Promise<void> {
    // Chain writes: each waits for the previous, so the snapshot written is
    // always the latest cache state and never a torn interleave.
    this.writeChain = this.writeChain.then(async () => {
      const payload = JSON.stringify(Object.fromEntries(this.cache), null, 2);
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, payload, { mode: 0o600 });
    });
    return this.writeChain;
  }
}
