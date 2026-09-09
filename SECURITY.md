# Security design and remaining work

## Implemented foundation

- Browser identity comes only from a server-to-server Discord code exchange. OAuth state is single-use, expires after 10 minutes, and is bound to the initiating HttpOnly browser cookie.
- The callback verifies at least one bot-accessible server where the current user has the actual Administrator permission or ownership before issuing a session.
- Every server endpoint re-fetches guild ownership, member roles, and role permission bits. Website role grants never bypass Discord membership/Administrator checks. Discord outages fail closed.
- The owner has all website capabilities. Other admins start with activity viewing; the owner delegates capabilities. Non-owner managers cannot edit roles they hold, @everyone, managed roles, equal/higher roles, or protected grants outside their own capability set. Equal-position roles are conservatively denied; reorder them in Discord.
- The bot's credentials never reach the frontend. OAuth access tokens and CSRF secrets are encrypted with AES-256-GCM using row-specific authenticated context. Session cookie values are stored only as SHA-256 hashes. Production cookies are Secure, HttpOnly, SameSite=Lax, and use the __Host- prefix.
- Sessions expire after 30 minutes idle and at most 8 hours total (or sooner when the access token expires). No refresh token is stored. Logout removes the session before attempting provider revocation.
- Mutations require exact Origin matching plus a session-bound CSRF header. Input validation rejects unexpected grant fields. HTTP body size is bounded. HTML is rendered through React rather than raw HTML injection.
- Restrictive CSP, frame denial, no-referrer, HTTPS HSTS in production, no-store API/auth responses, and disabled camera/microphone/geolocation permissions.
- The process binds loopback only and does not trust forwarded IP headers. Rate limiting currently groups traffic from the same loopback proxy; deployment must validate suitable limits rather than trusting arbitrary forwarded headers.
- SQLite uses prepared statements, private file modes, WAL, foreign keys, secure deletion, and transactional grant/activity updates. Activity contains action identifiers rather than message bodies. Expired activity is excluded from reads and purged hourly at 90 days; OAuth state/session expiry is enforced at access time.

## Limits and remaining work

Sensitive-field encryption does not encrypt the entire database or hide metadata. A compromise of the running Pi can expose its key. Device hardening, disk protection, restricted service account, system updates, resource limits, backup encryption/expiry, recovery exercises, monitoring, and Cloudflare/public routing are not complete yet. Secure deletion cannot guarantee physical erasure from SD-card wear-leveling or unmanaged backups.

The current suite verifies application behavior with fake Discord responses, not Discord's production service. Live role changes, token revocation, bot permission failures, OAuth callback behavior, production cookies behind the chosen proxy, and Pi 3 B+ resource use must be tested before deployment.

Future message collection must be explicit per configured channel and disclosed to members. Store only required content, avoid message bodies in activity logs, apply 90-day expiry to exports/backups under our control, and implement deletion/removal workflows. Export downloads under an administrator's control cannot be recalled by the bot.

Never post a vulnerability containing credentials or private message data to a public issue. Rotate exposed Discord credentials in the Developer Portal and remove affected sessions. Changing the encryption key invalidates stored encrypted sessions; back up and rotate deliberately before encrypted message storage is added.

## Sources checked during design

- [Discord OAuth](https://docs.discord.com/developers/topics/oauth2): confidential authorization-code flow with `identify guilds`. Membership is checked through the bot API, so `guilds.members.read` is not requested.
- [Discord permissions](https://docs.discord.com/developers/topics/permissions): Administrator bit and owner semantics.
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding): private command replies and response/token limits for future commands.
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/) and [Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/): stable domain requirements and development-only temporary URLs.
- [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): Node 24 built-in SQLite is still marked experimental; its use keeps native build dependencies small for a Pi. Runtime is constrained to Node 24 and data access is covered by tests.
