# Discord Bot

A Raspberry Pi-friendly Discord management bot and accessible administration website. **In development: login, permissions, channel messaging, and the staff DM inbox are implemented; live Discord setup still pending. This is not yet the complete management bot.**

## Implemented

- Discord OAuth login with single-use, browser-bound state. No password login or demo bypass.
- Current Discord Administrator permission AND authentication; server owners retain full control without needing a role.
- Per-server website capabilities, strictly lower-role delegation, protection against changing your own roles or granting capabilities you lack.
- Encrypted server-side OAuth sessions, hashed session IDs, 30-minute idle and 8-hour absolute expiry, logout/revocation, CSRF/origin checks, security headers, rate limits, prepared SQL.
- Accessible dashboard shell, server selection, activity, role editor, first-login walkthrough with skip/reset, accessibility and privacy statements.
- Bot connection using Guilds and DirectMessages intents, with no privileged Message Content intent. Private `/help`, `/dashboard`, `/ping`, and `/contact` replies, permission-aware help, and two-minute deletion of server command replies.
- Website channel composer with draft review, disabled mention pings, durable duplicate-send protection, delivery status checks, and uncertain-send recovery.
- Opt-in staff inbox for each server. Members explicitly choose their server through `/contact` or a DM server picker; current membership is verified before accepting messages or sending staff replies.
- Encrypted DM text and attachment metadata, retained for 90 days. Authorized administrators can read conversations, review and send replies, check delivery status, and close conversations. Attachment files are not downloaded or archived; Discord links can expire.
- SQLite activity retention and automated security/behavior checks. Server-channel message audit and exports remain a later stage.

## Local development

Requires Node.js **24.14 or newer within 24 LTS**, and npm. Raspberry Pi target: **Pi 3 B+ with 64-bit Raspberry Pi OS Lite**. Actual Pi performance has not yet been measured.

```sh
npm ci
npm run check
npm start
```

Open http://127.0.0.1:3000. Without credentials, only the setup screen is available. No live Discord actions occur. `npm run build` must run before `npm start`.

For OAuth testing, copy `.env.example` to `.env` and fill all four credential/key placeholders locally. Follow [the foundation setup notes](docs/SETUP.md). Never commit `.env`, tokens, databases, exports, or backups. Production mode refuses missing credentials and non-HTTPS origins. The service binds only to loopback. Do not expose a development server or forward a router port to it.

The optional frontend development server is `npm run dev:web`; the backend is `npm run dev`. Use the compiled same-origin site for authentication and mutation testing unless you set `APP_ORIGIN=http://127.0.0.1:5173` and register that exact callback for development.

## Development stages

Server-channel chat auditing is developed separately on [`feature/message-audit`](https://github.com/Kindleisbest/discord-bot/tree/feature/message-audit). Keep its message collection, audit storage/views, and audit exports off `main` until Andrew explicitly approves merging it for release. The existing private staff DM inbox and administration activity remain on `main`. The audit implementation has not started yet.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the complete request and current resume point. Remaining work includes the 90-day server-channel message audit and exports, events, member tutorials, Instagram-link embeds, leveling after the questionnaire, deployment hardening, and the final illustrated Raspberry Pi installation PDF.

Tests use a fake Discord adapter to exercise security decisions without credentials. Live OAuth, a Discord test server, Raspberry Pi load, and public deployment still require validation. No claim of complete security or accessibility certification is made.

## Security

See [SECURITY.md](SECURITY.md). No paid service or AI API is needed. Cloudflare alone is not the security boundary. A stable free address and secure Cloudflare-compatible deployment path will be decided during deployment; a free registrable domain is not guaranteed.
