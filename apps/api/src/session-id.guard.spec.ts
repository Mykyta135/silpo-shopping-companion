import { BadRequestException, type ExecutionContext } from '@nestjs/common';
import { SessionIdGuard, isValidSessionId, sessionFingerprint } from './session-id.guard.js';

const ctx = (req: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

describe('session id guard', () => {
  const guard = new SessionIdGuard();
  const random = 'a3f9c2e1b7d84f60a1c2d3e4f5a6b7c8';

  it('rejects the old shared demo id and other guessable ids', () => {
    expect(isValidSessionId('demo-session-1')).toBe(false);
    expect(isValidSessionId('x')).toBe(false);
    expect(isValidSessionId('a'.repeat(200))).toBe(false);
    expect(isValidSessionId('../../etc/passwd/xxxxxxxxxxxxxxxxxxxxx')).toBe(false);
    expect(() => guard.canActivate(ctx({ body: { sessionId: 'demo-session-1' } }))).toThrow(
      BadRequestException,
    );
  });

  it('accepts a random per-install id from body or query, and requests without one', () => {
    expect(guard.canActivate(ctx({ body: { sessionId: random } }))).toBe(true);
    expect(guard.canActivate(ctx({ query: { sessionId: random } }))).toBe(true);
    expect(guard.canActivate(ctx({ body: {}, query: {} }))).toBe(true);
  });

  it('logs a short fingerprint, never the id itself', () => {
    expect(sessionFingerprint(random)).toHaveLength(8);
    expect(sessionFingerprint(random)).not.toContain(random.slice(0, 8));
  });
});
