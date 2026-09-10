# Discord Bot — project checkpoint

Requested by Andrew, 2026-09-08. Work through the stages in order, save completed work to GitHub, and keep this file current. Check Codex five-hour and weekly remaining allowance between stages; if either is below 5%, finish a safe checkpoint and ask the user to say `resume`. Do not redeem usage resets without explicit permission.

## Confirmed requirements

- Raspberry Pi **3 B+**, 1 GB RAM; target 64-bit Raspberry Pi OS Lite. Build frontend assets away from the Pi when possible.
- Discord OAuth **AND** the Discord Administrator permission for all website access; server owner exception even without roles. Higher Discord roles manage only lower roles' website permissions. Owner controls all website permissions. Changing website permissions never grants Discord roles.
- Distinct server workspaces with all requests and database records scoped to a server.
- Latest activity and website message composer.
- Private staff inbox: members DM the bot, administrators reply on the website. Explicit server selection for users sharing multiple servers.
- Message audit retention 90 days, scheduled cleanup, export. Avoid retaining message contents in application logs and activity history.
- Instagram links shared in Discord trigger a custom embed in the configured destination channel. User clarified this; automatic account polling is not requested.
- Website-created Discord events and announcement, including optional graphic.
- Discoverable slash commands; permission-aware /help with a temporary ephemeral response and a quiet moderator-contact action. A slash invocation is not a regular posted message to delete.
- Detailed leveling questionnaire **before implementing leveling**.
- /tutorial with admin-authored channel-by-channel content and channel visibility checks.
- First-login admin walkthrough with skip and reset.
- Accessible navigation, keyboard/focus support, reduced motion, readable contrast, footer accessibility statement.
- Placeholder credentials only. Detailed illustrated multi-page Raspberry Pi PDF at the **end**, based on the finished and tested installation. Link suitable official instructional videos where useful; do not invent recordings.
- Security layers beyond Cloudflare, no paid subscriptions. No owned domain; stable free address/Cloudflare architecture must be resolved honestly.
- GitHub repository requested as “discord bot”; use `discord-bot` (repository names cannot contain spaces). User created `Kindleisbest/discord-bot`; it is public. Publish code/documentation only, never secrets or runtime data.

## Stages

1. [x] Secure foundation: configuration, persistent database, Discord OAuth sessions, live role checks, server isolation, owner override, permission editor, accessible dashboard shell, health checks, security tests.
2. [x] Bot gateway, slash /help, /dashboard and /ping, latest activity, reviewed website composer. /contact belongs to the staff inbox stage.
3. [ ] Staff inbox and message audit. Staff DM inbox/replies/routing/90-day purge are complete; server-channel audit and exports remain.
4. [ ] Events with graphics and announcements; configurable member tutorials and admin onboarding.
5. [ ] Instagram links shared in Discord: configurable destination and custom embed.
6. [ ] Ask detailed leveling questions; implement only after answers.
7. [ ] Pi deployment hardening, free-address decision, backup/restore, end-to-end and accessibility validation.
8. [ ] Final detailed installation PDF with images and official video links, release checklist.

## Current checkpoint — 2026-09-10

Stages 1–2 complete: secure OAuth/role-gated website, owner exception, per-server permissions, accessible dashboard, onboarding skip/reset, bot commands and reviewed channel composer. Previous GitHub checkpoint: `7f9dbab350df1887e1ea46df016c2d1d4828e8e5`.

Stage 3a complete: opt-in per-server staff DM inbox, `/contact` and private Help contact button, explicit DM server picker, fresh membership checks, safe server switching, encrypted conversations, reviewed website replies, delivery checks, closing, pagination and exact 90-day expiry. Attachments retain Discord links/metadata only; files are not downloaded. Disabling blocks new intake and new replies while retained history remains available. Global source-message dedup prevents replay into a second server. Encryption authenticates content and immutable conversation/actor/routing/timestamp metadata. Pending replies become uncertain after restart and are never automatically replayed.

Validation: all **140** automated tests pass; frontend/server typechecks and production build pass. Isolated browser QA with fake Discord responses passes simulated OAuth, disabled replies, enable intake, reading/reviewing/sending exactly one reply, escaped content, close/filter/read-only history and privacy footer navigation. Mobile width 390px has no horizontal overflow and no browser errors occurred. Saved desktop screenshot: `docs/design/inbox-verified.png`. Live Discord and real Pi testing remain outstanding; no credentials or real member messages were used.

NEXT: stage 3b opt-in server-channel message audit and safe exports (including retained staff conversations). Confirm Message Content intent setup, collect only configured channels, retain original/edited/deleted content no longer than 90 days, encrypt bodies, bound resource use for Pi 3 B+, and enforce live role/guild checks on every read and export. No channel collection or exports exist in stage 3a. Then proceed with events/tutorials and Instagram-link announcements. Leveling questionnaire is still mandatory before building leveling. The final PDF must wait for the completed deployment.

GitHub repository is public: https://github.com/Kindleisbest/discord-bot. Publish source/docs only. CLI authentication is invalid; authenticated connector Git Data create_tree/create_commit/update_ref works. Use non-force writes with the verified current remote parent. Keep `.env`, runtime data, backups, exports, and temporary fake-auth UI harnesses ignored. The test harness is isolated on loopback and is not shipped with the application. Root database schema remains version 2; the inbox owns additional tables. No deployed inbox-data migration is needed yet because no real installation exists.

Stage 3a is saved and verified on GitHub at `cfb0972de1a4229af91068196ea2613d50a2edaf`; its tree exactly matches the local checkpoint. The isolated fake Discord preview has been stopped.

Usage on resume: 4% five-hour used, 65% weekly used. Final check: 75% five-hour used (25% remaining), 76% weekly used (24% remaining). Pause at this tested milestone because the next substantial audit/export implementation risks exhausting the user's 5% buffer. User should say `resume`; recheck allowance first. No reset credit was redeemed.

## Architecture

Node.js 24 LTS + TypeScript, Fastify serving a prebuilt React/Vite frontend, discord.js gateway in the same service, SQLite on local disk. One small process instead of a server fleet for Pi 3 B+. Opaque server-side sessions, encrypted sensitive fields, prepared SQL, bounded reads, no login bypass or demo backend. Production binds loopback behind a secure access path. All bot tokens stay server-side. No paid AI services required.
