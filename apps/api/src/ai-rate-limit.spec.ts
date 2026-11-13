import { Controller, INestApplication, Post, UseGuards } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AgentController } from './agent/agent.controller.js';
import { ShoppingController } from './shopping/shopping.controller.js';
import {
  AI_LIMIT_PER_IP,
  AI_LIMIT_PER_SESSION,
  AiRateLimitModule,
  trackByIp,
  trackBySession,
} from './ai-rate-limit.js';

// The real controllers are imported only to read their decorators. Their
// services pull in ESM-only packages (the AI SDK, the MCP client) that jest
// here does not transform, so they are stubbed.
jest.mock('./agent/agent.service.js', () => ({ AgentService: class {} }));
jest.mock('./shopping/shopping.service.js', () => ({
  ShoppingService: class {},
}));
jest.mock('./mcp/silpo-mcp.service.js', () => ({
  SilpoMcpService: class {},
  SilpoAuthorizationRequired: class extends Error {},
}));

@Controller('ai')
class AiController {
  @Post('limited')
  @UseGuards(ThrottlerGuard)
  limited() {
    return { ok: true };
  }

  @Post('free')
  free() {
    return { ok: true };
  }
}

const sessionId = (n: number) => `s${String(n).padStart(40, '0')}`;

describe('AI rate limit', () => {
  let app: INestApplication<App>;

  // A fresh app per test, so the in-memory counters start empty.
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AiRateLimitModule],
      controllers: [AiController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (id: string, path = '/ai/limited') =>
    request(app.getHttpServer()).post(path).send({ sessionId: id });

  it('answers 429 after the per-session limit, and only for that session', async () => {
    for (let i = 0; i < AI_LIMIT_PER_SESSION; i++) {
      await call(sessionId(1)).expect(201);
    }
    await call(sessionId(1)).expect(429);
    await call(sessionId(2)).expect(201);
  });

  it('limits per IP when every request carries a new session id', async () => {
    for (let i = 0; i < AI_LIMIT_PER_IP; i++) {
      await call(sessionId(i)).expect(201);
    }
    await call(sessionId(AI_LIMIT_PER_IP)).expect(429);
  });

  it('does not limit a route without the guard', async () => {
    for (let i = 0; i < AI_LIMIT_PER_SESSION + 5; i++) {
      await call(sessionId(1), '/ai/free').expect(201);
    }
  });

  describe('routes that start a paid LLM call', () => {
    // If one of these loses its guard, nothing else fails: the route just
    // stops being limited. So pin them here.
    const handlerOf = (controller: { prototype: object }, name: string) =>
      Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as
        object | undefined;

    it.each([
      ['POST /agent/chat', AgentController, 'chat'],
      ['POST /shopping/list', ShoppingController, 'list'],
      ['POST /shopping/event', ShoppingController, 'event'],
    ])('%s is behind the throttler guard', (_route, controller, name) => {
      const handler = handlerOf(controller, name);
      expect(handler).toBeDefined();
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler as object) as
        unknown[] | undefined;
      expect(guards).toContain(ThrottlerGuard);
    });
  });

  describe('trackers', () => {
    it('counts by session id when there is one, from the body or the query', () => {
      expect(
        trackBySession({ ip: '1.1.1.1', body: { sessionId: 'abc' } }),
      ).toBe('session:abc');
      expect(
        trackBySession({ ip: '1.1.1.1', query: { sessionId: 'xyz' } }),
      ).toBe('session:xyz');
    });

    it('falls back to the IP when the session id is missing or not a string', () => {
      expect(trackBySession({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
      expect(trackBySession({ ip: '1.1.1.1', body: { sessionId: 42 } })).toBe(
        'ip:1.1.1.1',
      );
      expect(trackBySession({ ip: '1.1.1.1', body: { sessionId: '' } })).toBe(
        'ip:1.1.1.1',
      );
    });

    it('counts by IP only', () => {
      expect(trackByIp({ ip: '2.2.2.2', body: { sessionId: 'abc' } })).toBe(
        'ip:2.2.2.2',
      );
    });
  });
});
