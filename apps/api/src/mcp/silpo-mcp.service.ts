import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SilpoAuthProvider } from './silpo-auth.provider.js';
import { TokenStore } from './token-store.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Raised when the guest must complete the Silpo login before tools can be used. */
export class SilpoAuthorizationRequired extends Error {
  constructor(public readonly authorizationUrl: string) {
    super('Silpo authorization required');
    this.name = 'SilpoAuthorizationRequired';
  }
}

interface Session {
  client: Client;
  transport: StreamableHTTPClientTransport;
  provider: SilpoAuthProvider;
}

@Injectable()
export class SilpoMcpService implements OnModuleDestroy {
  private readonly logger = new Logger(SilpoMcpService.name);
  private readonly sessions = new Map<string, Session>();
  /** De-dupes concurrent connect attempts for the same session. */
  private readonly connecting = new Map<string, Promise<Session>>();
  private readonly serverUrl: string;
  private readonly callbackUrl: string;

  constructor(
    private readonly store: TokenStore,
    config: ConfigService,
  ) {
    this.serverUrl = config.get('SILPO_MCP_URL', 'https://mcp.silpo.ua/mcp');
    this.callbackUrl = config.get(
      'OAUTH_CALLBACK_URL',
      'http://localhost:3000/auth/silpo/callback',
    );
  }

  /**
   * Connects (or reuses a connection) for a guest session.
   * @throws SilpoAuthorizationRequired when the guest still needs to log in.
   */
  async getClient(sessionId: string): Promise<Client> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing.client;

    const inFlight = this.connecting.get(sessionId);
    if (inFlight) return (await inFlight).client;

    const attempt = this.connect(sessionId);
    this.connecting.set(sessionId, attempt);
    try {
      return (await attempt).client;
    } finally {
      this.connecting.delete(sessionId);
    }
  }

  private async connect(sessionId: string): Promise<Session> {
    const provider = new SilpoAuthProvider(sessionId, this.store, this.callbackUrl);
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      authProvider: provider,
    });
    const client = new Client(
      { name: 'silpo-hackathon-agent', version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (err) {
      await transport.close().catch(() => undefined);
      // The SDK throws UnauthorizedError after driving discovery + DCR + PKCE and
      // calling redirectToAuthorization(); the provider captured the URL for us.
      if (err instanceof UnauthorizedError && provider.pendingAuthorizationUrl) {
        throw new SilpoAuthorizationRequired(provider.pendingAuthorizationUrl);
      }
      throw err;
    }

    const session: Session = { client, transport, provider };
    this.sessions.set(sessionId, session);
    this.logger.log(`MCP session connected: ${sessionId}`);
    return session;
  }

  /**
   * Completes the OAuth flow with the code returned to the redirect URI,
   * then opens the authorized MCP session.
   */
  async finishAuthorization(sessionId: string, code: string): Promise<void> {
    const provider = new SilpoAuthProvider(sessionId, this.store, this.callbackUrl);
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      authProvider: provider,
    });
    try {
      await transport.finishAuth(code);
    } finally {
      await transport.close().catch(() => undefined);
    }
    await this.store.clear(sessionId, 'verifier');
    this.logger.log(`Authorization completed for session ${sessionId}`);
  }

  async isAuthorized(sessionId: string): Promise<boolean> {
    return Boolean((await this.store.get(sessionId)).tokens?.access_token);
  }

  /**
   * Reads the live tool list from the server. Always prefer this over a hardcoded
   * list — the server is the source of truth for names and JSON Schemas.
   */
  async listTools(sessionId: string): Promise<McpTool[]> {
    const client = await this.getClient(sessionId);
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(
    sessionId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = await this.getClient(sessionId);
    return client.callTool({ name, arguments: args });
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)));
  }
}
