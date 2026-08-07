/** Wire contract between the Expo app and the NestJS agent endpoint. */

export interface ChatRequest {
  /** Opaque session id; maps to a server-side MCP token. Never send tokens from the client. */
  sessionId: string;
  message: string;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; toolName: string; args: unknown }
  | { type: 'tool-result'; toolName: string; ok: boolean }
  | { type: 'awaiting-approval'; toolName: string; args: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string };

export interface AuthStatus {
  authorized: boolean;
  /** Present when authorized === false: URL the guest must open to log in to Silpo. */
  authorizationUrl?: string;
}
