import type { AgentTurnResult, AuthStatus, ChatRequest } from './types';

/**
 * Base URL of the NestJS agent API.
 *
 * The mobile client talks ONLY to this API — it never holds a Silpo MCP token.
 * On a physical device, replace localhost with the LAN IP of the dev machine.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      authorizationUrl?: string;
    };
    const error = new Error(body.message ?? `Request failed: ${res.status}`) as Error & {
      authorizationUrl?: string;
      status?: number;
    };
    error.authorizationUrl = body.authorizationUrl;
    error.status = res.status;
    throw error;
  }

  return res.json() as Promise<T>;
}

export function getAuthStatus(sessionId: string): Promise<AuthStatus> {
  return request<AuthStatus>(`/auth/silpo/status?sessionId=${encodeURIComponent(sessionId)}`);
}

export function sendMessage(body: ChatRequest): Promise<AgentTurnResult> {
  return request<AgentTurnResult>('/agent/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
