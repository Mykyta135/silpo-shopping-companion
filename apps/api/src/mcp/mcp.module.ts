import { Module } from '@nestjs/common';
import { SilpoMcpService } from './silpo-mcp.service.js';
import { TokenStore } from './token-store.js';
import { AuthController } from './auth.controller.js';

@Module({
  controllers: [AuthController],
  providers: [SilpoMcpService, TokenStore],
  exports: [SilpoMcpService],
})
export class McpModule {}
