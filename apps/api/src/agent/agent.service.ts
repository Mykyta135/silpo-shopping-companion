import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { McpToolsFactory } from './mcp-tools.factory.js';
import { SILPO_SYSTEM_PROMPT } from './system-prompt.js';

export interface AgentTurnResult {
  text: string;
  toolCalls: { toolName: string; args: unknown }[];
  steps: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly anthropic;
  private readonly modelId: string;
  /** Conversation history per guest session. Swap for Redis/Postgres beyond a demo. */
  private readonly history = new Map<string, ModelMessage[]>();

  constructor(
    private readonly toolsFactory: McpToolsFactory,
    config: ConfigService,
  ) {
    // Key is read from the environment — never hardcode or log it.
    this.anthropic = createAnthropic({
      apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
    this.modelId = config.get('AGENT_MODEL', 'claude-sonnet-5');
  }

  async chat(sessionId: string, message: string): Promise<AgentTurnResult> {
    // State-changing tools pause for explicit guest approval in free-form chat.
    const tools = await this.toolsFactory.build(sessionId);
    const messages = this.history.get(sessionId) ?? [];
    messages.push({ role: 'user', content: message });

    const result = await generateText({
      model: this.anthropic(this.modelId),
      system: SILPO_SYSTEM_PROMPT,
      messages,
      tools,
      // Multi-step: cart context -> search -> mutate -> verify needs several hops.
      stopWhen: stepCountIs(12),
    });

    this.history.set(sessionId, [...messages, ...result.response.messages]);

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((c) => ({
        toolName: c.toolName,
        args: c.input,
      })),
      steps: result.steps.length,
    };
  }

  reset(sessionId: string): void {
    this.history.delete(sessionId);
  }
}
