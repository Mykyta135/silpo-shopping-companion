import type {
  AddToCartResponse,
  AisleEventResponse,
  AisleEventType,
  AuthStatus,
  ListResponse,
  ZoneId,
} from './types';

/**
 * Base URL of the NestJS agent API.
 *
 * The mobile client talks ONLY to this API — it never holds a Silpo MCP token.
 * On a physical device, replace localhost with the LAN IP of the dev machine.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3010';

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

/**
 * Loads the active list, or undefined when none has been built yet.
 * A 404 here is the normal "no list yet" state, not an error.
 */
export async function getList(sessionId: string): Promise<ListResponse | undefined> {
  try {
    return await request<ListResponse>(
      `/shopping/list?sessionId=${encodeURIComponent(sessionId)}`,
    );
  } catch (err) {
    if ((err as { status?: number }).status === 404) return undefined;
    throw err;
  }
}

/** Phase 1: the agent assembles a list from receipts, coupons and price moves. */
export function buildList(sessionId: string, guestRequest?: string): Promise<ListResponse> {
  return request<ListResponse>('/shopping/list', {
    method: 'POST',
    body: JSON.stringify({ sessionId, request: guestRequest }),
  });
}

/** Guest edits the agent's proposal. */
export function patchList(
  sessionId: string,
  patch: {
    add?: { title: string; quantity?: number; unit?: string };
    removeId?: string;
    /** Switch an item between its main product and an alternative. */
    choose?: { itemId: string; productId: string };
    /** Where the guest says they are standing; positioning is manual. */
    currentZone?: ZoneId;
  },
): Promise<ListResponse> {
  return request<ListResponse>('/shopping/list', {
    method: 'PATCH',
    body: JSON.stringify({ sessionId, ...patch }),
  });
}

/** Phase 2: report what happened in the aisle; the agent may react, or stay quiet. */
export function sendEvent(
  sessionId: string,
  type: AisleEventType,
  payload: { itemId?: string; zone?: ZoneId } = {},
): Promise<AisleEventResponse> {
  return request<AisleEventResponse>('/shopping/event', {
    method: 'POST',
    body: JSON.stringify({ sessionId, type, ...payload }),
  });
}

/** Writes the chosen products into the guest's real Silpo cart. */
export function addToCart(
  sessionId: string,
  itemIds?: string[],
): Promise<AddToCartResponse> {
  return request<AddToCartResponse>('/shopping/cart', {
    method: 'POST',
    body: JSON.stringify({ sessionId, itemIds }),
  });
}

export function resetList(sessionId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/shopping/list?sessionId=${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
}
