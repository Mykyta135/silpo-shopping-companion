import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AgentModule } from './agent/agent.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { ShoppingModule } from './shopping/shopping.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    McpModule,
    AgentModule,
    ShoppingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
