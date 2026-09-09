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
2. [ ] Bot gateway, slash /help and private /contact, latest activity, website message composer.
3. [ ] Staff DM inbox, replies, per-server routing, audit capture, 90-day purge, safe export.
4. [ ] Events with graphics and announcements; configurable member tutorials and admin onboarding.
5. [ ] Instagram integration using supported account access and explicit setup.
6. [ ] Ask detailed leveling questions; implement only after answers.
7. [ ] Pi deployment hardening, free-address decision, backup/restore, end-to-end and accessibility validation.
8. [ ] Final detailed installation PDF with images and official video links, release checklist.

## Current checkpoint

Stage 1 implemented: 66 security tests pass, frontend/server typechecks pass, production asset build passes. Desktop (1505×1045) and mobile (390×844) browser checks pass for setup screen, locked permissions, footer link, and responsive overflow. No Discord credentials requested or used: live OAuth/server tests remain for installation. Admin first-login skip/reset walkthrough also implemented as part of the foundation.

GitHub: user created https://github.com/Kindleisbest/discord-bot, public, initial README commit 7625abe87bc7e286a2431e69131a29503429bb14. CLI auth remains invalid; use authenticated GitHub connector for writes. Stage 1 is being saved as the next commit.

Resume at stage 2: gateway lifecycle, slash /help and /contact, latest gateway activity, website message composer. Complete modmail in stage 3 before claiming DM contact is operational. Leveling questionnaire still required later. Final installation PDF not yet started, intentionally.

Usage hit 100% in the original allowance window. User said resume; next check showed a reset to 2% used. Continue checking between stages. No reset credit was redeemed by the agent.

## Architecture

Node.js 24 LTS + TypeScript, Fastify serving a prebuilt React/Vite frontend, discord.js gateway in the same service, SQLite on local disk. One small process instead of a server fleet for Pi 3 B+. Opaque server-side sessions, encrypted sensitive fields, prepared SQL, bounded reads, no login bypass or demo backend. Production binds loopback behind a secure access path. All bot tokens stay server-side. No paid AI services required.
