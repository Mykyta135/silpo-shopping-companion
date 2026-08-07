import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module.js';
import { AgentService } from './agent.service.js';
import { AgentController } from './agent.controller.js';

@Module({
  imports: [McpModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
