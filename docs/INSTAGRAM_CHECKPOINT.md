# Instagram announcements — connected implementation checkpoint

Updated 12 September 2026. Instagram URL recognition, per-server settings, explicit activation, gateway intake, checked Discord delivery, durable outgoing records, and read-only website history are connected. Posting remains off by default and needs both host and server activation. Live Discord and Raspberry Pi verification remain pending. This feature does not merge or activate the separate `feature/message-audit` work.

## Activation and website permissions

1. The host enables **Message Content Intent** on the application's **Bot** page in the Discord Developer Portal, sets `INSTAGRAM_LINKS_ENABLED=true` in the local environment, and restarts the service. The supplied configuration defaults to `false`. This adds GuildMessages and MessageContent intents to the default Guilds and DirectMessages intents. Follow Discord's [privileged Message Content intent requirements](https://docs.discord.com/developers/events/gateway#message-content-intent).
2. An authorized administrator opens **Instagram** for the selected server, chooses at least one source and a different destination, enters the embed title, checks **Enable automatic Instagram link posting**, and saves. New configurations and legacy setups without an explicit enabled value remain disabled.

Viewing settings, channel choices, and delivery history requires **Manage Instagram** (`instagram.manage`). Every save, including disabling, also requires **Send channel messages** (`messages.send`), same-origin CSRF protection, and the usual live Discord Administrator/owner gate. Website grants do not replace the bot's Discord permissions.

The website distinguishes saved activation from unsaved edits and shows host availability and bot connection state. Disabled setups can be saved with incomplete or unavailable channels, including while the bot is offline; their saved channel IDs remain visible until explicitly removed or replaced. Settings, channel choices, and history load independently. Enabling requires successful live setup checks. Saving does not send a test message. Disabling prevents new work and invalidates pending pre-send authorization, but cannot recall a POST already submitted to Discord.

## Supported input and scope

- Explicit HTTPS links on exactly `instagram.com` or `www.instagram.com`.
- Post `/p/` and reel `/reel/` paths with a 1–64 character ASCII shortcode: letters, digits, underscore, or hyphen.
- Optional trailing slash, query, and fragment. Canonical links use HTTPS and `www.instagram.com`, preserve shortcode case, and remove tracking queries/fragments.
- Plain links, Discord angle brackets, and Markdown link destinations; common trailing sentence punctuation is ignored.
- Duplicate shortcodes within a message are combined, including post/reel aliases. The first encountered link is retained, with at most three links processed per event.

This limited format does not establish whether an Instagram post exists or is public. Profile/story links, short links, credentials, explicit ports, encoded paths, dot segments, lookalike hosts, and non-HTTPS links are rejected. No redirect is followed. Messages longer than 4,000 characters are rejected rather than truncated; at most ten URL candidates are examined, including invalid candidates. Individual accepted URLs are limited to 2,048 characters. Quotes and code still count as text; the helper does not fully interpret Discord formatting.

Only new message-create events in explicitly enabled, selected server text or announcement channels are eligible. DMs, partial messages, bots, webhooks, system messages, threads, and other channel types are ignored. Message edits do not start a new delivery. Discord's library may deliver guild events from channels outside the selected sources when the global intents are enabled; the application checks enabled settings and configured source IDs before accessing event content. The service keeps no message cache, performs no history scan, and does not archive the original message body. Instagram images, videos, captions, and account credentials are not fetched.

## Settings, permissions, and destination audience

Settings support up to 25 unique sources, one different destination, a required title of up to 100 characters, an optional description of up to 2,000 characters, and a six-digit hex color. The preview shows static administrator-authored text and color; it does not substitute placeholders. Configuration is encrypted and authenticated to its server, revision, and update timestamp. Revision checks prevent concurrent edits from silently overwriting each other. Active configuration persists until replaced or bot removal; the 90-day outgoing-record limit does not expire it.

Enabling and every send verify supported channels within the same server. The bot needs **View Channel** and **Read Message History** in the source, and **View Channel**, **Send Messages**, and **Embed Links** in the destination. Each source and the destination must have matching View Channel allow/deny overrides for the same roles and members. Only the posting bot's own direct member override is excluded. This is a conservative policy based on [Discord's permission-overwrite model](https://docs.discord.com/developers/topics/permissions#permission-overwrites); channels with apparently identical members can still be rejected.

Before sending, the transport refreshes the guild, role list, bot membership, source and destination channels, and original author membership. The author must still be a human server member with View Channel in both channels. The bot [fetches the single source message](https://docs.discord.com/developers/resources/message#get-channel-message) by ID without caching it; it must still match the server, channel, author, and canonical Instagram URL. A deleted message or removed link fails the check. It never fetches a channel-history list.

The service checks that posting remains enabled and that the configuration revision, source selection, and destination still match immediately before submitting the message. Each delivered embed contains the configured title/description/color and canonical Instagram URL. Mentions are disabled. A permission or settings change after submission cannot retract a Discord post, and future source-message edits or deletion do not update an already delivered embed.

## Durable delivery records and status

A server/source-message/shortcode identity reserves one job atomically before any send. Repeated copies of the same event keep the original destination and outgoing payload even if settings change. Separate messages sharing an Instagram post remain separate events and are subject to processing limits. The sender uses a stable short Discord nonce with nonce enforcement as additional duplicate protection.

Outgoing URL/text and routing/author identifiers are encrypted and authenticated to the server, job ID, timestamp, and record format. Server/job IDs, timestamps, status, and confirmed destination message IDs remain database metadata. Activity contains identifiers and action names, without original chat bodies or authored embed text. Storage failure or unreadable records stop work instead of bypassing the reservation.

| Status | Meaning |
|---|---|
| Pending | An outgoing reservation exists; no final result has been recorded. |
| Sent | Discord returned a message ID and that confirmation was recorded. |
| Failed | A definite pre-send or delivery failure was recorded. |
| Uncertain | The service could not safely confirm the send result, including unfinished work recovered after restart. |

A failure to persist a confirmed Discord send is treated conservatively as uncertain or left pending for startup recovery. Startup changes pending records to uncertain. Sent, failed, and uncertain records cannot be reopened. No failed or uncertain delivery is automatically retried, and the website provides no retry control.

**Delivery history** returns the latest 100 records from the selected server within retention, showing status, outgoing title/URL, channel IDs, and time. Sent records with a confirmed message ID link to Discord. **Refresh status** only reads records and preserves an unsaved settings draft. History does not enumerate every shared link: work skipped before reservation has no outgoing record.

## Resource limits and retention

| Limit | Current behavior |
|---|---|
| Canonical links per eligible event | At most 3; remaining recognized links are skipped. |
| Per-user processing | At most 3 link-bearing message events per 60-second window, across servers. |
| Per-server processing | At most 10 link-bearing message events per 60-second window. |
| Global processing | At most 60 link-bearing message events per 60-second window. |
| Concurrent processing jobs | At most 3 overall and 1 per server. |
| Channel lookups | The options path and the posting/setup-check path each permit at most 3 concurrent operations; setup checks its source channels sequentially. |
| Retained outgoing records | At most 1,000 per server and 10,000 overall, counting all stored statuses. |
| Source message age | Under 5 minutes old, with timestamps over 1 minute ahead rejected. |

Rate limits count message events, not individual embeds. Busy or rate-limited events are skipped; the service does not maintain an unbounded backlog or guarantee delivery for every link. Rate tracking is held in memory, bounded to 5,000 keys, and resets on restart; durable duplicate protection survives restart.

Outgoing jobs expire locally at 90 days. Reads exclude expired records, and startup/hourly cleanup removes them. Bot removal deletes that server's Instagram configuration and records from the active database. At capacity, new reservations are rejected until cleanup makes room; retained duplicate protection is never evicted to accept new work. Cleanup does not delete posts held by Discord or copies in the host's backups.

The source-age gate also prevents normal old-event replays from being accepted after retention cleanup. Delayed events outside the window are skipped, and the host needs an accurate clock. It uses the source message's [Discord snowflake timestamp](https://docs.discord.com/developers/reference#snowflakes), in addition to the live source-message and permission checks.

## Remaining verification

The current implementation has dedicated automated coverage for URL parsing, settings/routes, gateway/service processing, Discord preflight/send behavior, and durable records. Current run results and the overall resume point belong in [PROJECT_PLAN.md](../PROJECT_PLAN.md); this document does not claim a completed browser or full-suite verification run.

Before release, verify live Discord intent setup, a permitted source-to-destination delivery, audience and role changes, deleted/edited source messages, offline disabling, and delivery outcomes. Measure Pi 3 B+ memory, CPU, network behavior, and storage growth under the bounded workload. Public deployment and the final illustrated Pi installation guide remain separate pending work. No audit branch is merged by enabling Instagram processing.
