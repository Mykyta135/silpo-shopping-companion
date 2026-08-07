/**
 * Local mirror of the API contract.
 *
 * Kept separate from @silpo/shared because Metro does not resolve workspace
 * TypeScript sources without extra config; these few types are cheap to duplicate.
 */

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: { toolName: string; args: unknown }[];
  steps: number;
}

export interface AuthStatus {
  authorized: boolean;
  authorizationUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: string[];
}
