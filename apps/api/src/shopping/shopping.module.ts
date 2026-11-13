import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { AiRateLimitModule } from '../ai-rate-limit.js';
import { McpModule } from '../mcp/mcp.module.js';
import { ListStore } from './list.store.js';
import { ShoppingController } from './shopping.controller.js';
import { ShoppingService } from './shopping.service.js';

@Module({
  imports: [McpModule, AgentModule, AiRateLimitModule],
  controllers: [ShoppingController],
  providers: [ShoppingService, ListStore],
})
export class ShoppingModule {}
