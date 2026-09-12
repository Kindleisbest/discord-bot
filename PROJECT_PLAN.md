# Discord Bot — project checkpoint

Requested by Andrew, 2026-09-08. Work through the stages in order, save completed work to GitHub, and keep this file current. Current usage rule (updated by Andrew on 2026-09-11): stop feature work when either the five-hour or weekly allowance is exhausted. Credits may be used only to finish saving work, then stop. Do not spend credits on more development. Do not redeem banked reset credits unless needed and explicitly authorized. This supersedes the earlier 5% stopping threshold recorded below.

**Latest resume point: Instagram posting implemented and locally verified; leveling requirements in progress.** See the final milestone below; earlier checkpoint entries are history. Initial leveling answers are recorded in docs/LEVELING_QUESTIONNAIRE.md; obtain the remaining answers before implementation. Live Discord/Pi deployment and the final PDF remain later.

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
5. [x] Instagram links shared in Discord: configurable destination/custom embed, explicit activation, safe delivery, and website history. Local tests pass; live Discord verification remains.
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

## Instagram delivery-record checkpoint — 2026-09-11

Andrew clarified that 23% means remaining. Earlier 90%/66% entries labeled used were assistant assumptions, not verified readings. The live usage meter is still unavailable; use the user's remaining-allowance reports and do not invent updated percentages. Credits remain authorized only for finishing saves.

Implemented durable encrypted Instagram delivery reservations, per-event duplicate protection retaining the original destination, immutable terminal states, pending-to-uncertain restart recovery, exact 90-day expiry, per-server/global capacity limits, and source-snowflake age checks against replay after pruning. Main initializes/recover/prunes/removes this storage. No gateway or sender uses it yet and posting remains unavailable. All 223 automated tests, both typechecks, and production build pass. No frontend behavior changed.

NEXT: implement enabled-setting migration with explicit activation, incoming gateway checks and bounded rate limits, audience policy and fresh authorization, actual Discord embed transport with safe uncertain-result handling, and website delivery status. Do not silently activate saved configurations. Audit stays separate, leveling requires the questionnaire, and the final installation PDF remains deferred. Save and verify this checkpoint, then pause before a larger stage.

## Instagram posting milestone — 2026-09-12

Andrew confirmed both five-hour and weekly allowances were **100% remaining** on resume. Live usage reporting remains unavailable; do not invent a current percentage. Credits remain restricted to finishing saves. No reset credit was redeemed by the assistant.

Stage 5 is connected end to end: explicit host environment opt-in and separate server enablement; legacy configurations remain disabled; selected-channel gateway intake; fresh source-message, membership, channel, and conservative audience checks; custom canonical-link embeds with disabled mentions; durable reservation before POST; no automatic replay after any failure or uncertain result; encrypted 90-day outgoing history; and immediate cancellation of unfinished preflight authorization when stopping. The host switch alone cannot activate saved server setups.

The website distinguishes saved activation from an unsaved switch, shows runtime availability, allows disabling offline while preserving channel IDs, and loads settings/channel choices/history independently. Read requires instagram.manage; any save also requires messages.send. Channel-permission errors are distinct from revision conflicts. History is read-only and refresh preserves drafts. Limits bound events, concurrent work, and stored records for the Pi; see docs/INSTAGRAM_CHECKPOINT.md. Optional message intents allow Discord's library to receive guild events; configured sources are checked before reading event content. Original server-chat bodies are not archived, and no history lists or Instagram media are fetched.

Validation: **249 automated tests**, both typechecks, and production build pass. Browser checks with simulated Discord passed explicit enable/saved status, input validation, source/destination separation, unsaved navigation, draft-preserving history refresh, sent/failed/uncertain records, route errors versus revision conflicts, deliberate reload, offline disabling with saved IDs, escaped text, keyboard navigation, and mobile 390px without horizontal overflow. Desktop/mobile screenshots were visually inspected. Saved screenshot: docs/design/instagram-posting-verified.png. No credentials, live messages, or real member content were used.

NEXT: ask Andrew the detailed leveling questionnaire before implementing it; the owner-only Pi Party remains planned only. Audit collection/views/exports stay unimplemented on feature/message-audit and require explicit approval before release. Deployment hardening, stable free address/Cloudflare decision, real Discord/Pi tests, backups/restoration, final accessibility validation, and the illustrated installation PDF remain outstanding. Save all stage changes to GitHub main with a verified non-force update; keep the audit branch unchanged and stop the isolated preview before ending work.

The isolated preview is now stopped. An additional browser check passed read-only Instagram settings/history with editing disabled for a view-only website grant. The detailed leveling questionnaire is prepared in docs/LEVELING_QUESTIONNAIRE.md; start with the core behavior and follow up on the remaining parameters. No leveling choices or implementation are assumed from silence.

## Leveling requirements — first answer

Andrew's latest usage report is **97% remaining**; the live allowance tool remains unavailable. Keep work in small checkpoints and reserve credits for finishing saves.

Confirmed: XP for interactive participation including messages, replies, and received reactions; no XP for giving reactions; staff can disable earning in selected channels and need safeguards. Additional activity types, reply bonuses, reaction removal/abuse rules, and channel inclusion/exclusion behavior are the next questions. Record answers in docs/LEVELING_QUESTIONNAIRE.md. Formula, reward, privacy, retention, and remaining administration requirements are still pending; do not implement leveling yet. This checkpoint changes documentation only, so the previous 249-test result remains the last application validation; no new test run is needed.

Andrew subsequently clarified that the scope is any activity that keeps people engaged and chose simpler shared controls for all activities. Plan one shared set of XP amount, cooldown, and daily-cap controls with channel/role exclusions; do not design separate numeric controls for each activity. The specific values and eligibility rules remain open. A bounded official-Discord-docs review is recorded in docs/LEVELING_ACTIVITY_SCOPE.md: messages/replies/forums, received reactions, polls, and voice presence are observable; RSVPs are interest, not attendance, and voice presence does not prove attention. Stop asking Andrew to enumerate activity types. Ask about progression speed, shared safeguards, rewards, channel policies, and privacy next. No leveling code or gateway intent changes have been made.

Progression answer: every level should get harder; level 1 can take about 30 seconds. Andrew explicitly clarified that advancing from level 19 to level 20 alone should take about a week of regular participation. Levels should continue indefinitely with no fixed maximum. Increase the XP cost of successive levels and plan numeric storage/calculations for growing totals. The subsequently accepted numerical curve and defaults are recorded below. These are participation-based targets; the activity rules and shared limits will affect actual progress.

Rewards confirmed: staff set level-to-role milestones; new rewards replace earlier leveling reward roles instead of accumulating. Level-up announcements go to a staff-selected channel. Andrew approved the starting anti-spam policy: ignore bots/self-reactions, one reaction award per reacting person/message, no extra reward for reaction removal/re-addition, and a shared message/reply cooldown with staff-adjustable shared cooldown/daily cap. A private opt-out command deletes the member's XP, removes their leveling reward role, and excludes them from earning/leaderboards. Departed-member progress is retained for 30 days, then deleted. Voice XP needs at least two eligible humans, excludes AFK/deafened time, and permits muted listeners. Category/channel exclusions inherit into child threads and forum posts. Authorized staff can adjust XP, reset individuals, and pause earning; only the owner can reset everyone; changes require a recorded reason.

Staff choose whether level-up announcements ping the member; default to no ping. Andrew accepted the mathematically checked starting defaults in docs/LEVELING_QUESTIONNAIRE.md: 10 XP/award, one shared 30-second cooldown across activities, 1,200 daily cap, and 10*n² XP per level advance. The modeled pace is about a week for 19-to-20 at 600 XP/day, and about 48 days total to level 20 at that same rate. Staff can adjust the shared earning controls. All member leveling commands (/rank, /leaderboard, /rewards, and opt-out controls) reply privately and use readable text embeds. Earned XP stays after message/reaction deletion; staff can correct abuse. Manage only leveling reward roles assigned by this bot and preserve manually assigned roles. Start fresh, with no import needed. Current questions cover reaction-message age limits, daily reset time, and leaderboard periods. Remaining administration/reporting and reward-update details are open. No leveling implementation yet.

SAVE-ONLY CHECKPOINT: Andrew requested saving progress after interrupting the requirements discussion. Save all confirmed answers and the explicit pending questions, verify GitHub matches the local files, then stop. No leveling code, runtime settings, or gateway changes were started. On resume, continue with the unanswered reaction-message age limit, daily-cap reset time, and leaderboard-period questions; preserve the confirmed defaults above. The last application validation remains 249 passing tests plus successful typechecks/build and simulated browser checks; this requirements-only save needs no new application test run.
