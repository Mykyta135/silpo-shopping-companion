import { Injectable, Logger } from '@nestjs/common';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { isSilpoReadTool, isSilpoWriteTool } from '@silpo/shared';
import { SilpoMcpService } from '../mcp/silpo-mcp.service.js';

/**
 * Bridges the live MCP tool list into AI SDK tools.
 *
 * Schemas come from `tools/list` at runtime rather than being hardcoded, so the
 * agent automatically picks up server-side changes to the Silpo tool surface.
 * Shared by the free-form chat agent and the quest flows.
 */
@Injectable()
export class McpToolsFactory {
  private readonly logger = new Logger(McpToolsFactory.name);

  constructor(private readonly mcp: SilpoMcpService) {}

  /**
   * @param sessionId Guest session whose MCP token backs the calls.
   * @param requireApproval When true, state-changing tools pause for guest
   *   confirmation. Quest flows pass false: the guest already approved the
   *   action by tapping «Зібрати кошик», so a second prompt is redundant.
   * @param onToolCall Invoked for each tool call, so callers can surface which
   *   MCP tools ran.
   * @param readOnly Expose only read tools. Used by flows whose prompts carry
   *   untrusted text (list titles, coupon and product descriptions): even a
   *   successful prompt injection there has no tool that changes the account.
   */
  async build(
    sessionId: string,
    options: {
      requireApproval?: boolean;
      readOnly?: boolean;
      onToolCall?: (toolName: string) => void;
    } = {},
  ): Promise<ToolSet> {
    const { requireApproval = true, readOnly = false, onToolCall } = options;
    const tools = await this.mcp.listTools(sessionId);
    const toolSet: ToolSet = {};

    for (const t of tools) {
      if (readOnly && !isSilpoReadTool(t.name)) continue;
      toolSet[t.name] = dynamicTool({
        description: t.description ?? t.name,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        needsApproval: requireApproval && isSilpoWriteTool(t.name),
        execute: async (args) => {
          this.logger.log(`tool_call ${t.name}`);
          onToolCall?.(t.name);
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
}
