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

Future server-channel message collection must be explicit per configured channel and disclosed to members. Message audit and exports are not implemented yet. Keep message bodies out of activity logs, apply 90-day expiry to exports/backups under our control, and implement deletion/removal workflows. Export downloads under an administrator's control cannot be recalled by the bot. Current database cleanup does not remove copies from an operator's backups or from Discord.

Never post a vulnerability containing credentials or private message data to a public issue. Rotate exposed Discord credentials in the Developer Portal and remove affected sessions. Losing or replacing `DATA_ENCRYPTION_KEY` makes stored sessions and staff DM content unreadable. There is no automatic key-rotation or recovery tool yet. Preserve a protected recovery copy of the key separately from the database, and protect and expire any database backups; never commit either to GitHub.

## Sources checked during design

- [Discord OAuth](https://docs.discord.com/developers/topics/oauth2): confidential authorization-code flow with `identify guilds`. Membership is checked through the bot API, so `guilds.members.read` is not requested.
- [Discord permissions](https://docs.discord.com/developers/topics/permissions): Administrator bit and owner semantics.
- [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding): private command replies and response/token limits for future commands.
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/) and [Quick Tunnel limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/): stable domain requirements and development-only temporary URLs.
- [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): Node 24 built-in SQLite is still marked experimental; its use keeps native build dependencies small for a Pi. Runtime is constrained to Node 24 and data access is covered by tests.

## Commands, composer, and staff inbox

The gateway requests Guilds and DirectMessages intents and caches no messages. It does not request the privileged Message Content intent or collect server-channel messages. Every channel-composer send re-fetches guild/channel/roles/bot membership, rejects cross-server targets and unsupported channel types, and verifies View Channel plus Send Messages. Allowed mentions are empty. A client request UUID has a durable per-guild record and content fingerprint; modified drafts or other actors cannot reuse it. A short Discord nonce adds upstream duplicate protection. Ambiguous transport failures are never automatically replayed; pending records become uncertain after restart. Delivery metadata expires at 90 days. Command reply timers are stopped at shutdown; the original help/dashboard/ping/contact replies are ephemeral and scheduled for deletion after two minutes.

Each server's staff inbox starts disabled. A settings administrator must enable it. Members explicitly select a destination with `/contact` in that server or the DM picker. A first DM without an active destination is not saved or forwarded; the member is asked to select a server and resend it. Picker tokens are bound to the user and permitted server choices, are single-use, and expire after 10 minutes. Routes expire after 24 hours. Membership and enabled status are checked before intake and new replies. Disabling the inbox blocks new intake and replies while preserving retained history and delivery checks for authorized administrators.

Inbox website routes use the same current Administrator/owner gate and per-server authorization. Reading conversations requires `inbox.read`; replying and closing also require `inbox.reply`. The service encrypts message text and attachment metadata with AES-256-GCM, authenticated to the server and message row. Message identifiers, participants, timestamps, status, and routing metadata remain visible in the database. Activity records identifiers and action names, never DM content.

Messages at or beyond 90 days are excluded from reads and removed by startup/hourly cleanup. Incoming Discord message IDs are deduplicated. Reply reservations bind the request ID to the server, conversation, actor, and content; uncertain sends are never retried automatically. Incoming text is bounded to 4,000 characters and replies to 2,000. Gateway work and per-user request rates are bounded. Only HTTPS attachment links on the supported Discord CDN hosts are accepted; no attachment bytes are downloaded and links may expire. Bot removal deletes that server's inbox records, routes, settings, grants, activity, and delivery metadata from the active database.

## Event creation checkpoint

Event reads require current Administrator/owner access plus events.manage. Creation and announcement recovery also require messages.send. Fresh bot roles, membership, channel permissions, and event ownership are checked before external actions. Event creation needs Create Events, with the additional voice/Stage channel permissions documented by Discord. Announcement channels require View Channel, Send Messages, and Embed Links. Mentions are disabled.

A durable request fingerprint binds the actor and exact event draft, including the graphic. Event creation and announcement delivery are recorded separately. Discord event creation has no request nonce; a timeout or crash therefore produces an uncertain result that is never automatically recreated. Only a confirmed created event with a definitely failed or not-started announcement can retry that announcement. Unfinished POSTs become uncertain after restart. At most three event jobs run concurrently, with one per server.

Graphic uploads accept PNG/JPEG data only, up to 1 MiB, with bounded declared dimensions. The Pi checks image headers without decoding or fetching external image URLs; Discord validates the actual image encoding. Graphic bytes are sent to Discord and are not retained locally. Announcements use the event's Discord-hosted cover image and the supplied graphic description. Encrypted request details and delivery metadata expire after 90 days; cleanup does not delete Discord events or announcements. The latest 100 requests are shown. Production and Pi verification remain outstanding.

Source: [Discord scheduled events and permissions](https://docs.discord.com/developers/resources/guild-scheduled-event), checked 2026-09-10.

## Member tutorials

Editor reads/writes require current Discord Administrator or ownership plus tutorial.manage. Every save checks that the channel still belongs to the server and is a supported bot-visible channel. Draft/published text is encrypted with authenticated server, channel, revision, and timestamp metadata. Optimistic revisions reject stale edits; clearing creates an empty unpublished revision instead of resetting it. Activity stores actor/channel/action metadata only. Configurations persist beyond message retention until changed, cleared, or the bot leaves the server; at most 1,000 records are kept per server.

The public member command is guild-only and replies privately. Each page refreshes guild roles (including eviction of deleted cached roles), bot membership, member membership, and channel permissions. Only published steps visible to both member and bot are returned. Published content is read after the live lookup, so unpublishing during that lookup does not return the old step. Neither the command nor editor reads channel messages.

Navigation uses unpredictable in-memory tokens bound to the user and server; only an owned ephemeral interaction can update an existing reply. Sessions expire after ten minutes, are bounded to 1,000, and are cleaned periodically. Restart invalidates controls. Per-user throttling and three concurrent lookup slots bound resource usage. Failed refreshes clear prior step content when Discord accepts the update. Mentions cannot ping; content is administrator-authored Discord Markdown. Already delivered replies/copies cannot be recalled while Discord is unavailable, and access checks cannot retract content already seen by a member.

Source: [Discord application commands](https://docs.discord.com/developers/interactions/application-commands) and [components](https://docs.discord.com/developers/components/reference), checked 2026-09-11. Live Discord and Pi verification remain pending.

## Instagram setup checkpoint

Settings reads require live Administrator/owner access plus instagram.manage; writes also require messages.send, same-origin CSRF protection, and fresh bot channel checks. Source channels require bot View Channel; destinations also require Send Messages and Embed Links. Only text/announcement channels are accepted and the destination cannot also be a source. Configurations allow at most 25 unique sources, a 100-character title, 2,000-character description, and a six-digit color. Three simultaneous channel refreshes are allowed. Encrypted configuration authenticates server/revision/timestamp; activity excludes authored text. Configuration persists until replaced or bot removal and stale edits fail rather than overwrite newer settings.

Posting remains unavailable: no message-reading intent or gateway handler is added, every configuration returns enabled:false, and input cannot set enabled. The future sender must explicitly address destination audiences, duplicate prevention, mentions, and uncertain delivery before a separate enable action becomes available.

## Instagram delivery-record foundation

A separate internal reservation table holds encrypted outgoing payloads and routing metadata, bound by authenticated encryption to a versioned server/job/time context. Reservation keys deduplicate a source Discord message and Instagram shortcode within a server. Atomic capacity checks and insertion precede any future send; all retained statuses count toward limits. Restart marks unfinished work uncertain and terminal states cannot be reopened. Ninety-day cleanup plus a five-minute source age gate avoids accepting old replays after pruning under normal clock operation. A wrong key or unreadable row fails closed.

This checkpoint adds storage lifecycle handling only. No gateway or external sender calls it, no channel-reading intent is enabled, and the website still cannot activate posting. End-to-end permission checks, audience policy, rate limits, and send-result handling remain required before activation.
