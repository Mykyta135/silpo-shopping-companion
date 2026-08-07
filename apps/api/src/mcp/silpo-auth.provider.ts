import { randomUUID } from 'node:crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { TokenStore } from './token-store.js';

/**
 * OAuth 2.1 + PKCE provider for https://mcp.silpo.ua/mcp, scoped to one guest session.
 *
 * The Silpo authorization server advertises Dynamic Client Registration and
 * `token_endpoint_auth_method: "none"` (public client), so registration happens
 * automatically on first connect — see /.well-known/oauth-authorization-server.
 *
 * The guest's Silpo JWT never reaches this process; we only ever hold the MCP token.
 */
export class SilpoAuthProvider implements OAuthClientProvider {
  /**
   * Set when the caller has an authorization URL pending user interaction.
   * The HTTP layer surfaces this to the client instead of opening a browser,
   * because this runs headless on a server.
   */
  public pendingAuthorizationUrl?: string;

  constructor(
    private readonly sessionId: string,
    private readonly store: TokenStore,
    private readonly callbackUrl: string,
  ) {}

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Silpo Hackathon Agent',
      redirect_uris: [this.callbackUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  async state(): Promise<string> {
    // Bind the OAuth callback back to this session, and double as CSRF protection.
    const value = randomUUID();
    await this.store.update(this.sessionId, { oauthState: value });
    return value;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.get(this.sessionId)).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.store.update(this.sessionId, { clientInformation: info });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.get(this.sessionId)).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.update(this.sessionId, { tokens });
    this.pendingAuthorizationUrl = undefined;
  }

  /**
   * Headless: we cannot open a browser. Capture the URL so the API can hand it
   * to the guest, who completes login on auth.silpo.ua.
   */
  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl.toString();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.update(this.sessionId, { codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.get(this.sessionId)).codeVerifier;
    if (!verifier) {
      throw new Error(
        `No PKCE code verifier for session ${this.sessionId}; restart the authorization flow.`,
      );
    }
    return verifier;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'discovery') return;
    await this.store.clear(this.sessionId, scope);
  }
}
