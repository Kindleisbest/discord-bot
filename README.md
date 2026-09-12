# Discord Bot

A Raspberry Pi-friendly Discord management bot and accessible administration website. **In development: login, permissions, channel messaging, the staff DM inbox, event creation, member tutorials, and opt-in Instagram link posting are implemented; live Discord setup still pending. This is not yet the complete management bot.**

## Implemented

- Discord OAuth login with single-use, browser-bound state. No password login or demo bypass.
- Current Discord Administrator permission AND authentication; server owners retain full control without needing a role.
- Per-server website capabilities, strictly lower-role delegation, protection against changing your own roles or granting capabilities you lack.
- Encrypted server-side OAuth sessions, hashed session IDs, 30-minute idle and 8-hour absolute expiry, logout/revocation, CSRF/origin checks, security headers, rate limits, prepared SQL.
- Accessible dashboard shell, server selection, activity, role editor, first-login walkthrough with skip/reset, accessibility and privacy statements.
- Bot connection using Guilds and DirectMessages intents by default. Optional Instagram processing adds GuildMessages and privileged MessageContent only when the host explicitly enables it. Private `/help`, `/dashboard`, `/ping`, and `/contact` replies, permission-aware help, and two-minute deletion of those command replies.
- Website channel composer with draft review, disabled mention pings, durable duplicate-send protection, delivery status checks, and uncertain-send recovery.
- Opt-in staff inbox for each server. Members explicitly choose their server through `/contact` or a DM server picker; current membership is verified before accepting messages or sending staff replies.
- Encrypted DM text and attachment metadata, retained for 90 days. Authorized administrators can read conversations, review and send replies, check delivery status, and close conversations. Attachment files are not downloaded or archived; Discord links can expire.
- Website-created external, voice, and Stage events with a reviewed announcement, optional PNG/JPEG graphic and accessible description, separate delivery statuses, and safe recovery of a failed announcement.
- Channel-by-channel tutorial editor with encrypted drafts, publication controls, text preview, and conflict protection. Members use private `/tutorial` with Previous/Next/Close and fresh channel access checks; controls expire after ten minutes.
- Opt-in Instagram post/reel link embeds with selected source/destination channels, custom text/color, conservative audience checks, disabled mentions, durable duplicate protection, and read-only delivery history. Host and server switches both start disabled; original chat bodies and Instagram media are not archived.
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

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the complete request and current resume point. Remaining work includes the 90-day server-channel message audit and exports, leveling after the questionnaire, deployment hardening, and the final illustrated Raspberry Pi installation PDF.

Tests use a fake Discord adapter to exercise security decisions without credentials. Live OAuth, a Discord test server, Raspberry Pi load, and public deployment still require validation. No claim of complete security or accessibility certification is made.

## Administrator access

See the [administrator permissions guide](docs/ADMIN_PERMISSIONS.md) for feature requirements, role setup examples, delegation rules, and troubleshooting.

## Instagram link posting

Keep `INSTAGRAM_LINKS_ENABLED=false` unless the host intends to enable Instagram processing. To activate it, enable **Message Content Intent** in the application's Discord Developer Portal **Bot** settings, set `INSTAGRAM_LINKS_ENABLED=true`, and restart the service. Discord documents the privileged-intent requirements in its [Gateway guide](https://docs.discord.com/developers/events/gateway#message-content-intent).

For each server, open **Instagram**, choose up to 25 text/announcement source channels and a different destination, enter the embed title, explicitly check **Enable automatic Instagram link posting**, and save. Existing saved setups remain disabled until explicitly enabled. **Manage Instagram** permits reading settings and delivery history; saving, including disabling, also requires **Send channel messages**. Disabled setups can still be saved when the bot is offline or a channel is unavailable.

The bot needs View Channel and Read Message History in every source, and View Channel, Send Messages, and Embed Links in the destination. Source and destination must have matching View Channel overrides, except for the bot's own member override; the source author must still be able to view both. This conservative check may reject channels that appear to have the same audience.

Only new eligible messages are considered. The application checks configured sources before accessing event content, then fetches the individual source message again before sending. It does not scan history or fetch Instagram images, videos, or captions. Outgoing records are encrypted and retained for 90 days; the website shows the latest 100 with a read-only status refresh and no retry action. Busy work, rate limits, permission failures, and full storage can skip delivery, so posting is not guaranteed for every link. See the [Instagram implementation checkpoint](docs/INSTAGRAM_CHECKPOINT.md) for exact limits and remaining live Discord/Pi validation.

## Security

See [SECURITY.md](SECURITY.md). No paid service or AI API is needed. Cloudflare alone is not the security boundary. A stable free address and secure Cloudflare-compatible deployment path will be decided during deployment; a free registrable domain is not guaranteed.
