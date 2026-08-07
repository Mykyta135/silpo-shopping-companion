# Silpo AI Factory — Hackathon Monorepo

AI shopping assistant built on the official **Silpo MCP server** (`https://mcp.silpo.ua/mcp`).
A NestJS API hosts the agent and holds OAuth tokens server-side; an Expo app is the chat client.

```
silpo-hackathon/
├── apps/
│   ├── api/        NestJS 11 — MCP client, OAuth 2.1 + PKCE, agent loop
│   └── mobile/     Expo SDK 57 / React Native 0.86 — chat UI
└── packages/
    └── shared/     Types + Silpo tool classification shared by both
```

## Stack

| Component | Version |
| --- | --- |
| NestJS | 11.1.28 |
| React Native | 0.86.2 (via Expo SDK 57) |
| MCP TypeScript SDK | 1.30.0 |
| Vercel AI SDK | 7.0.57 |
| Turborepo / Node | 2.10.9 / ≥22 |

## Setup

```bash
npm install

cp apps/api/.env.example apps/api/.env        # add ANTHROPIC_API_KEY
cp apps/mobile/.env.example apps/mobile/.env

npm run build
npm run dev            # api on :3000, Expo bundler
```

## Architecture

```
Expo app  ──HTTP──▶  NestJS API  ──MCP (Streamable HTTP)──▶  mcp.silpo.ua
 sessionId            MCP token                                39 tools
 (opaque)             (server-side only)
```

The mobile client never receives a Silpo MCP token — it sends only an opaque
`sessionId`. This satisfies the hackathon requirement to keep tokens server-side.

### Authorization flow

1. Client calls `GET /auth/silpo/status?sessionId=…`.
2. If unauthorized, the API drives OAuth discovery + Dynamic Client Registration +
   PKCE and returns an `authorizationUrl`.
3. The guest logs in at `auth.silpo.ua`; Silpo redirects to
   `GET /auth/silpo/callback`, where the code is exchanged for an MCP token.
4. Tokens are persisted server-side ([token-store.ts](apps/api/src/mcp/token-store.ts))
   and refreshed automatically by the MCP SDK.

The guest's Silpo JWT never leaves Silpo's infrastructure.

### Agent

[agent.service.ts](apps/api/src/agent/agent.service.ts) reads the live tool list via
`tools/list` at runtime and bridges each tool into the AI SDK with `dynamicTool` —
no hardcoded schemas, so server-side tool changes are picked up automatically.

State-changing tools (`silpo_add_or_update_cart_products`, `silpo_clear_shopping_cart`,
…) are marked `needsApproval`, so the agent pauses for guest confirmation.
Ordering rules from the Silpo docs — resolve cart context before cart-scoped tools,
re-validate the timeslot — are encoded in [system-prompt.ts](apps/api/src/agent/system-prompt.ts).

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /auth/silpo/status?sessionId=` | Auth state, or the login URL |
| `GET /auth/silpo/callback` | OAuth 2.1 redirect target |
| `POST /agent/chat` | `{ sessionId, message }` → agent turn |
| `DELETE /agent/session?sessionId=` | Reset conversation history |

## Commands

```bash
npm run dev          # all apps
npm run build
npm run typecheck
npm run test
```

## Verified

- OAuth discovery, DCR, and PKCE (S256) against the live Silpo server
- API boots with all routes mapped; 7 tests pass
- Metro bundles the Expo app in the monorepo (582 modules)

## Notes for production

- `TokenStore` is file-backed (mode `0600`, gitignored) — adequate for a demo.
  Move to encrypted database rows or a secrets manager for production.
- Conversation history is in-memory; use Redis/Postgres for multi-instance deploys.
- `sessionId` is currently unauthenticated — bind it to a real user session
  before exposing this beyond a demo.
