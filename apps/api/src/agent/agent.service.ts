import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { dynamicTool, generateText, jsonSchema, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import { isSilpoWriteTool } from '@silpo/shared';
import { SilpoMcpService } from '../mcp/silpo-mcp.service.js';
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
    private readonly mcp: SilpoMcpService,
    config: ConfigService,
  ) {
    // Key is read from the environment — never hardcode or log it.
    this.anthropic = createAnthropic({
      apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
    this.modelId = config.get('AGENT_MODEL', 'claude-sonnet-5');
  }

  /**
   * Bridges the live MCP tool list into AI SDK tools.
   *
   * Schemas come from `tools/list` at runtime rather than being hardcoded, so the
   * agent automatically picks up server-side changes to the 39 Silpo tools.
   */
  private async buildTools(sessionId: string): Promise<ToolSet> {
    const tools = await this.mcp.listTools(sessionId);
    const toolSet: ToolSet = {};

    for (const t of tools) {
      toolSet[t.name] = dynamicTool({
        description: t.description ?? t.name,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        // State-changing tools pause for explicit guest approval.
        needsApproval: isSilpoWriteTool(t.name),
        execute: async (args) => {
          this.logger.log(`tool_call ${t.name}`);
          try {
            return await this.mcp.callTool(
              sessionId,
              t.name,
              args as Record<string, unknown>,
            );
          } catch (err) {
            // Return the error to the model so it can recover (e.g. re-fetch
            // cart context) rather than aborting the whole turn.
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`tool_error ${t.name}: ${message}`);
            return { isError: true, error: message };
          }
        },
      });
    }

    return toolSet;
  }

  async chat(sessionId: string, message: string): Promise<AgentTurnResult> {
    const tools = await this.buildTools(sessionId);
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
