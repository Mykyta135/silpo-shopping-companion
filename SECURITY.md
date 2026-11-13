# Security

## Review, November 2026

Before linking this hackathon project from my CV I reviewed it for what a security-minded reviewer would find: secrets in the code and git history, who can drive a shopper's real Silpo account, how the agent's tools are gated, and prompt-injection paths. The review was AI-assisted (Claude Code); findings were checked against the code and the fixes have unit tests (140 API tests).

### Fixed

| Area | Problem | Fix |
|---|---|---|
| Sessions | Every install shared the session id `demo-session-1`, the only credential for a shopper's linked Silpo account | Random id per install (128-bit), kept in Keychain/Keystore; the API rejects short or guessable ids |
| Tool approval | Approval relied on a list of 6 write tools; the address tools and any tool Silpo adds later ran without confirmation | Fails closed: any tool that is not a known read tool needs the shopper's approval |
| Prompt injection | List-building and in-aisle agents read untrusted text (list titles, coupons, product descriptions) and had every write tool with approval off | These agents get read tools only; the cart is filled by plain code after the shopper taps the button |
| Input | No bounds on guest input that reaches prompts and the real cart | Title ≤ 120 chars, quantity 1–50, ≤ 60 items |
| CORS | Any origin was reflected | Only `CORS_ORIGINS` |
| Logs | Raw session ids in logs | A short hash instead |

No secrets were found in the code or history.

### Known limitations (demo)

- The session id is not tied to a user login yet, and the Silpo OAuth flow is not bound to the device that started it (needs a nonce cookie and a single-use `state`).
- OAuth tokens are stored in a local file; no rate limit on the AI endpoints.
- Test fixtures include a few real receipts and coupons from my own account, kept on purpose to test parsing against real data.

## Reporting

Please open a GitHub issue without exploit details.
