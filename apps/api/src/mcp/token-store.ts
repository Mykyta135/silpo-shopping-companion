import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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

/** What an encrypted store file looks like on disk (AES-256-GCM, all base64). */
interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function isEnvelope(value: unknown): value is Envelope {
  const e = value as Partial<Envelope> | null;
  return (
    typeof e === 'object' &&
    e !== null &&
    e.v === 1 &&
    typeof e.iv === 'string' &&
    typeof e.tag === 'string' &&
    typeof e.data === 'string'
  );
}

/** `MCP_TOKEN_STORE_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). */
function readStoreKey(): Buffer | undefined {
  const raw = process.env.MCP_TOKEN_STORE_KEY;
  if (!raw) return undefined;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    // Fail at boot rather than quietly storing tokens unencrypted.
    throw new Error('MCP_TOKEN_STORE_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

function encrypt(plaintext: string, key: Buffer): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(envelope: Envelope, key: Buffer): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * File-backed store, adequate for a hackathon demo on a single instance.
 *
 * With `MCP_TOKEN_STORE_KEY` set the file is encrypted at rest (AES-256-GCM,
 * a fresh IV per write); an existing plaintext file is encrypted on the next
 * write. Without the key it is stored as plain JSON, with a warning at start.
 * The file is gitignored (.mcp-tokens.json) and written with mode 0600.
 *
 * For production, swap the persistence methods for encrypted rows in Postgres
 * or a secrets manager — the interface is deliberately narrow to make that easy.
 */
@Injectable()
export class TokenStore {
  private readonly logger = new Logger(TokenStore.name);
  private readonly filePath = resolve(
    process.env.MCP_TOKEN_STORE_PATH ?? '.mcp-tokens.json',
  );
  private readonly key = readStoreKey();
  private cache = new Map<string, SessionAuthState>();
  private loaded = false;
  /** Serialises read-modify-write cycles so concurrent sessions can't clobber the file. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    if (!this.key) {
      this.logger.warn(
        'MCP_TOKEN_STORE_KEY is not set: tokens are stored unencrypted (fine for a local demo only)',
      );
    }
  }

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
    this.cache = new Map();

    let raw: string | undefined;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `Could not read token store: ${(err as Error).message}`,
        );
      }
    }

    if (raw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        this.logger.warn(
          `Could not read token store: ${(err as Error).message}`,
        );
      }

      if (isEnvelope(parsed)) {
        // An encrypted file we cannot read must stop the store. Starting empty
        // would let the next write replace the tokens in it.
        if (!this.key) {
          throw new Error(
            'Token store is encrypted but MCP_TOKEN_STORE_KEY is not set',
          );
        }
        let plaintext: string;
        try {
          plaintext = decrypt(parsed, this.key);
        } catch {
          throw new Error(
            'Token store could not be decrypted: wrong MCP_TOKEN_STORE_KEY or a damaged file',
          );
        }
        this.cache = new Map(
          Object.entries(
            JSON.parse(plaintext) as Record<string, SessionAuthState>,
          ),
        );
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Plaintext file: from before encryption, or written without a key.
        this.cache = new Map(
          Object.entries(parsed as Record<string, SessionAuthState>),
        );
      }
    }
    this.loaded = true;
  }

  private persist(): Promise<void> {
    // Chain writes: each waits for the previous, so the snapshot written is
    // always the latest cache state and never a torn interleave.
    this.writeChain = this.writeChain.then(async () => {
      const json = JSON.stringify(Object.fromEntries(this.cache), null, 2);
      const payload = this.key ? JSON.stringify(encrypt(json, this.key)) : json;
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, payload, { mode: 0o600 });
    });
    return this.writeChain;
  }
}
