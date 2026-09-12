# Discord Bot — project checkpoint

Requested by Andrew, 2026-09-08. Work through the stages in order, save completed work to GitHub, and keep this file current. Current usage rule (updated by Andrew on 2026-09-11): stop feature work when either the five-hour or weekly allowance is exhausted. Credits may be used only to finish saving work, then stop. Do not spend credits on more development. Do not redeem banked reset credits unless needed and explicitly authorized. This supersedes the earlier 5% stopping threshold recorded below.

## Confirmed requirements

- Raspberry Pi **3 B+**, 1 GB RAM; target 64-bit Raspberry Pi OS Lite. Build frontend assets away from the Pi when possible.
- Discord OAuth **AND** the Discord Administrator permission for all website access; server owner exception even without roles. Higher Discord roles manage only lower roles' website permissions. Owner controls all website permissions. Changing website permissions never grants Discord roles.
- Distinct server workspaces with all requests and database records scoped to a server.
- Latest activity and website message composer.
- Private staff inbox: members DM the bot, administrators reply on the website. Explicit server selection for users sharing multiple servers.
- Message audit retention 90 days, scheduled cleanup, export. Avoid retaining message contents in application logs and activity history.
- Audit release separation requested on 2026-09-10: develop server-channel chat collection, audit storage/views, and audit exports on `feature/message-audit`. Keep them off `main`; do not merge or release that branch until Andrew explicitly says it is ready. Existing staff DMs and administration activity stay on `main`.
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
4. [x] Events with graphics and announcements, configurable member tutorials, and administrator onboarding are implemented and locally tested. Live Discord verification remains.
5. [ ] Instagram links shared in Discord: configurable destination and custom embed.
6. [ ] Ask detailed leveling questions; implement only after answers.
7. [ ] Pi deployment hardening, free-address decision, backup/restore, end-to-end and accessibility validation.
8. [ ] Final detailed installation PDF with images and official video links, release checklist.

## Current checkpoint — 2026-09-10

Stages 1–2 complete: secure OAuth/role-gated website, owner exception, per-server permissions, accessible dashboard, onboarding skip/reset, bot commands and reviewed channel composer. Previous GitHub checkpoint: `7f9dbab350df1887e1ea46df016c2d1d4828e8e5`.

Stage 3a complete: opt-in per-server staff DM inbox, `/contact` and private Help contact button, explicit DM server picker, fresh membership checks, safe server switching, encrypted conversations, reviewed website replies, delivery checks, closing, pagination and exact 90-day expiry. Attachments retain Discord links/metadata only; files are not downloaded. Disabling blocks new intake and new replies while retained history remains available. Global source-message dedup prevents replay into a second server. Encryption authenticates content and immutable conversation/actor/routing/timestamp metadata. Pending replies become uncertain after restart and are never automatically replayed.

Validation: all **140** automated tests pass; frontend/server typechecks and production build pass. Isolated browser QA with fake Discord responses passes simulated OAuth, disabled replies, enable intake, reading/reviewing/sending exactly one reply, escaped content, close/filter/read-only history and privacy footer navigation. Mobile width 390px has no horizontal overflow and no browser errors occurred. Saved desktop screenshot: `docs/design/inbox-verified.png`. Live Discord and real Pi testing remain outstanding; no credentials or real member messages were used.

BRANCH PLAN: `main` continues with the remaining core bot features, starting with configurable member tutorials. Stage 3b server-channel message audit is isolated on `feature/message-audit` for development and review before Andrew approves release. No server-channel collection or audit export implementation exists yet, so no active collector needs removing from `main`. The existing staff DM inbox and administration activity stay on `main`.

WHEN WORKING ON `feature/message-audit`: confirm Message Content intent setup, collect only configured channels, retain original/edited/deleted content no longer than 90 days, encrypt bodies, bound resource use for Pi 3 B+, and enforce live role/guild checks on every read and export. Commit audit changes only to that branch. Do not merge it into `main` or include it in a main release without Andrew's explicit release instruction. Leveling questionnaire remains mandatory before building leveling. The final PDF must describe the features actually included in the chosen release.

GitHub repository is public: https://github.com/Kindleisbest/discord-bot. Publish source/docs only. CLI authentication is invalid; authenticated connector Git Data create_tree/create_commit/update_ref works. Use non-force writes with the verified current remote parent. Keep `.env`, runtime data, backups, exports, and temporary fake-auth UI harnesses ignored. The test harness is isolated on loopback and is not shipped with the application. Root database schema remains version 2; the inbox owns additional tables. No deployed inbox-data migration is needed yet because no real installation exists.

Stage 3a is saved and verified on GitHub at `cfb0972de1a4229af91068196ea2613d50a2edaf`; its tree exactly matches the local checkpoint. The isolated fake Discord preview has been stopped.

Usage on resume: 4% five-hour used, 65% weekly used. Final check: 75% five-hour used (25% remaining), 76% weekly used (24% remaining). Pause at this tested milestone because the next substantial audit/export implementation risks exhausting the user's 5% buffer. User should say `resume`; recheck allowance first. No reset credit was redeemed.

## Event milestone — 2026-09-10

Stage 4a implemented on main: external/voice/Stage event creation, optional PNG/JPEG cover graphic with accessible description, reviewed announcement, separately persisted event/announcement results, and explicit recovery of a definitely failed announcement. No automatic replay after uncertain creation/delivery. Graphic upload bytes are not stored; announcement graphics come from the Discord event cover. Event request details are encrypted and expire locally after 90 days; Discord events are not automatically deleted. Latest 100 requests shown.

All 165 automated tests, frontend/server typechecks, and production build pass. Browser plugin absent, so regular Playwright/Chromium used with isolated simulated Discord at 127.0.0.1:3001, desktop 1505x1045/mobile 390x844. Tested external/voice form, optional description, graphic and alt preview, time-zone review, escaped text, failed-announcement recovery without duplicate event, read-only status checks, and no horizontal overflow. Expected initial /api/me 401 before login is accounted for. Screenshots: docs/design/events-review-verified.png and events-result-verified.png. No live Discord actions or Pi tests.

NEXT on main: channel-by-channel member tutorials and /tutorial. Audit stays on feature/message-audit, unimplemented, until separately developed and approved for release. Event editing/cancellation is currently done in Discord. Final installation PDF remains deferred. Progress report: docs/PROGRESS_REPORT_2026-09-10.md updated for events.

Latest usage before saving: 81% five-hour used, 93% weekly used (7% weekly remaining). Finish this checkpoint and pause to protect the user's 5% buffer; do not start tutorials until allowance is checked after resume. Do not redeem resets. GitHub previous main: 5ba4c3023bc02592f7540a13d3bd3cb409c618d3, tree 31d409f0076523414420c3289e457026e6bc9448. Use connector non-force writes; keep audit branch unchanged.

## Architecture

Node.js 24 LTS + TypeScript, Fastify serving a prebuilt React/Vite frontend, discord.js gateway in the same service, SQLite on local disk. One small process instead of a server fleet for Pi 3 B+. Opaque server-side sessions, encrypted sensitive fields, prepared SQL, bounded reads, no login bypass or demo backend. Production binds loopback behind a secure access path. All bot tokens stay server-side. No paid AI services required.

## Member tutorial milestone — 2026-09-11

Stage 4b implemented on main: website channel-by-channel authoring, encrypted draft/published text, preview, clear/unpublish, optimistic edit conflict protection, unsaved-navigation warnings, and /tutorial with optional starting channel and private Previous/Next/Close. Current member and bot visibility are checked on every page lookup. Tokens are user/server bound, sessions expire after ten minutes, and lookup/session/rate limits protect the Pi. No server-channel message reading was added. Configuration is retained until changed/cleared/bot removal; member progress is not persisted.

Browser QA with isolated simulated Discord passed draft/publish, unsaved channel/page warnings, input validation/focus, escaped preview, a real concurrent-edit conflict and deliberate reload, clear/unpublish, keyboard navigation and mobile 390px without overflow. Screenshot: docs/design/tutorial-verified.png. Live Discord and Pi tests remain outstanding. The fake-auth harness remains ignored and must be stopped before pausing.

NEXT on main: Instagram links shared in Discord, with server-configured detection channels, destination and custom embed. Ask the detailed leveling questionnaire before building leveling. Audit remains unimplemented on feature/message-audit and requires explicit release approval; final PDF remains at the end. The owner-only Pi Party Easter egg is planned in docs/EASTER_EGG_PLAN.md and has not been implemented.

Usage after personal reset: initial 13% five-hour used / 2% weekly used; latest implementation check 74% five-hour used / 12% weekly used. Check allowance again at the final safe checkpoint and after resume. The user redeemed the prior reset themselves; two credits remain, none redeemed by the assistant.

Final tutorial verification: all 201 tests, both typechecks, and production build passed. Usage reached 92% five-hour used (8% remaining), 14% weekly used; finish saving and pause at this milestone to preserve the buffer. Say resume after allowance is available; recheck before the next substantial feature.

Saving checkpoint: five-hour allowance reached 100% used; weekly 16% used. Andrew authorized credits only for completing the save. Finish GitHub verification and stop; do not start Instagram work on credits. No banked reset has been redeemed by the assistant.

## Instagram URL checkpoint — 2026-09-11

Andrew resumed and reported 90% usage, interpreted as 90% used. The live allowance tool is unavailable in this session; do not invent remaining percentages. Completed a small standalone Instagram post/reel URL recognizer with canonical tracking-free links, duplicate handling, strict host/path checks, and bounded message/candidate processing. No gateway, message-reading intent, website configuration, or announcements were activated. See docs/INSTAGRAM_CHECKPOINT.md for the contract and next implementation step. Seven focused tests and both typechecks pass. Save to GitHub and pause here; credits remain authorized only for completing the save.

## Instagram settings checkpoint — 2026-09-11

Andrew reported 66% usage, treated as used; the live usage meter remains unavailable. Added encrypted per-server Instagram configuration, selected source/destination channels, static embed title/description/color, revision conflict protection, fresh bot permissions, and an accessible website editor. Read requires instagram.manage; write also messages.send and live Administrator/owner. Settings are setup-only and cannot activate posting. No gateway intents/message collection were added. All 216 automated tests, both typechecks, and production build pass.

NEXT: implement controlled Instagram gateway/delivery with durable deduplication and uncertainty handling, confirm source/destination audience policy, then explicit enable/setup requirements. Existing settings must never silently activate on upgrade. Audit remains separate and unimplemented; leveling questionnaire and final installation PDF remain later. Save this checkpoint and pause; credits are authorized only to finish saving.

Browser verification passed with simulated Discord: settings save, normalized color, source/destination separation, inactive status, unsaved navigation warning, conflict retention/reload, escaped preview, keyboard navigation, and 390px layout without overflow. Screenshot: docs/design/instagram-settings-verified.png. The temporary preview is stopped. Live Discord remains untested.
