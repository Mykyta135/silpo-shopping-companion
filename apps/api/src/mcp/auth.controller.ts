import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
} from '@nestjs/common';
import type { AuthStatus } from '@silpo/shared';
import {
  SilpoAuthorizationRequired,
  SilpoMcpService,
} from './silpo-mcp.service.js';
import { TokenStore } from './token-store.js';

@Controller('auth/silpo')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly mcp: SilpoMcpService,
    private readonly store: TokenStore,
  ) {}

  /**
   * Returns whether the session is authorized; if not, returns the URL the guest
   * must open to log in at auth.silpo.ua.
   */
  @Get('status')
  async status(@Query('sessionId') sessionId: string): Promise<AuthStatus> {
    if (!sessionId) throw new BadRequestException('sessionId is required');

    if (await this.mcp.isAuthorized(sessionId)) {
      return { authorized: true };
    }

    try {
      await this.mcp.getClient(sessionId);
      return { authorized: true };
    } catch (err) {
      if (err instanceof SilpoAuthorizationRequired) {
        return { authorized: false, authorizationUrl: err.authorizationUrl };
      }
      throw err;
    }
  }

  /** OAuth 2.1 redirect target. Exchanges the code for an MCP token, server-side. */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
  ): Promise<{ ok: true; message: string }> {
    if (!code || !state) {
      throw new BadRequestException('Missing code or state');
    }

    // `state` binds the callback to the session that started the flow (CSRF guard).
    const sessionId = await this.store.findBySessionState(state);
    if (!sessionId) {
      throw new BadRequestException('Unknown or expired OAuth state');
    }

    await this.mcp.finishAuthorization(sessionId, code);
    await this.store.update(sessionId, { oauthState: undefined });

    return { ok: true, message: 'Авторизація успішна. Можеш повертатись у застосунок.' };
  }
}
