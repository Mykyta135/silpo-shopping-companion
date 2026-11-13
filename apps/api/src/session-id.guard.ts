import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * The session id is the only credential the demo has (it keys the guest's
 * Silpo tokens), so it must be an unguessable random value — the mobile app
 * generates a UUID per install. Short or guessable ids such as
 * "demo-session-1" are rejected.
 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
}

/** Log this instead of the raw id, so logs cannot be replayed as a credential. */
export function sessionFingerprint(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8);
}

@Injectable()
export class SessionIdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      body?: { sessionId?: unknown };
      query?: { sessionId?: unknown };
    }>();
    const id = req.body?.sessionId ?? req.query?.sessionId;
    if (id === undefined) return true; // routes without a session (health, zones, OAuth callback)
    if (!isValidSessionId(id)) {
      throw new BadRequestException(
        'sessionId must be a random id of 32–128 characters',
      );
    }
    return true;
  }
}
