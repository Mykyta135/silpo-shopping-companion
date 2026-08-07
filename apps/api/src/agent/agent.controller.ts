import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import type { ChatRequest } from '@silpo/shared';
import { SilpoAuthorizationRequired } from '../mcp/silpo-mcp.service.js';
import { AgentService, type AgentTurnResult } from './agent.service.js';

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('chat')
  async chat(@Body() body: ChatRequest): Promise<AgentTurnResult> {
    if (!body?.sessionId || !body?.message) {
      throw new BadRequestException('sessionId and message are required');
    }

    try {
      return await this.agent.chat(body.sessionId, body.message);
    } catch (err) {
      if (err instanceof SilpoAuthorizationRequired) {
        // 401 carries the login URL so the client can open it.
        throw new UnauthorizedException({
          message: 'Silpo authorization required',
          authorizationUrl: err.authorizationUrl,
        });
      }
      throw err;
    }
  }

  @Delete('session')
  reset(@Query('sessionId') sessionId: string): { ok: true } {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    this.agent.reset(sessionId);
    return { ok: true };
  }
}
