import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

/**
 * Limits on the routes that start a paid LLM call: agent chat, list building
 * and aisle events. They are set far above real use, so they stop runaway
 * loops and scripted abuse, not shoppers.
 *
 * Two windows, because the session id is minted by the client: a per-session
 * limit alone is bypassed by sending a new random id with every request, so a
 * per-IP limit backs it up. Counters are kept per route, in memory, and expire
 * with the window.
 */
export const AI_WINDOW_MS = 60_000;
export const AI_LIMIT_PER_SESSION = 30;
export const AI_LIMIT_PER_IP = 120;

type RequestLike = {
  ip?: string;
  body?: { sessionId?: unknown };
  query?: { sessionId?: unknown };
};

/** Counts by session id; a request without a usable one falls back to the IP. */
export function trackBySession(req: RequestLike): string {
  const id = req.body?.sessionId ?? req.query?.sessionId;
  return typeof id === 'string' && id ? `session:${id}` : `ip:${req.ip}`;
}

export function trackByIp(req: RequestLike): string {
  return `ip:${req.ip}`;
}

/**
 * Import this in a module whose controller uses `@UseGuards(ThrottlerGuard)`
 * on an AI route. Routes without the guard are not limited.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'ai-session',
        ttl: AI_WINDOW_MS,
        limit: AI_LIMIT_PER_SESSION,
        getTracker: trackBySession,
      },
      {
        name: 'ai-ip',
        ttl: AI_WINDOW_MS,
        limit: AI_LIMIT_PER_IP,
        getTracker: trackByIp,
      },
    ]),
  ],
  exports: [ThrottlerModule],
})
export class AiRateLimitModule {}
