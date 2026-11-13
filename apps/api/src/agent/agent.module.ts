import { Module } from '@nestjs/common';
import { AiRateLimitModule } from '../ai-rate-limit.js';
import { McpModule } from '../mcp/mcp.module.js';
import { AgentService } from './agent.service.js';
import { AgentController } from './agent.controller.js';
import { McpToolsFactory } from './mcp-tools.factory.js';

@Module({
  imports: [McpModule, AiRateLimitModule],
  controllers: [AgentController],
  providers: [AgentService, McpToolsFactory],
  // QuestModule builds its own agent loops on the same MCP tool bridge.
  exports: [McpToolsFactory],
})
export class AgentModule {}
