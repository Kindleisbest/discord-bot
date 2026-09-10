# Discord Bot — Progress Report
**10 September 2026**

The secure website foundation, channel messaging, and private staff inbox, and event creation are implemented. The project is still in development and has not been validated with a live Discord server or on the Raspberry Pi.

## Feature status

| Area | Status | What is available or remaining |
|---|---|---|
| Discord login and access | Implemented | Discord OAuth plus current Administrator permission; server owners retain access without a role. |
| Separate server workspaces | Implemented | Server selection, isolated records, role-based website permissions, and higher-role delegation. |
| Activity and channel messaging | Implemented | Latest recorded activity, message review before sending, delivery checks, and duplicate-send protection. |
| Staff DM inbox | Implemented | Per-server enablement, explicit server selection, website replies, conversation closing, and retained history. |
| Staff message retention | Implemented | Encrypted DM content with 90-day expiry and cleanup. Attachments retain links only; those links may expire. |
| Slash commands | Implemented | /help, /dashboard, /ping, and /contact. Help is permission-aware; server command replies are private and scheduled for deletion after two minutes. |
| Administrator walkthrough | Implemented | First-login tutorial with skip and reset. |
| Accessibility | Foundation implemented | Keyboard/focus support, labeled controls, mobile layout, reduced-motion support, and footer accessibility statement. Full accessibility validation remains. |
| Server chat audit and audit exports | Separate development branch | feature/message-audit exists locally and on GitHub. Collection, audit views/storage, and exports have not been implemented. |
| Events and graphics | Implemented; local tests pass | External, voice, and Stage event creation with announcement, optional graphic, separate results, and failed-announcement recovery. Live Discord verification remains. |
| Member /tutorial | Planned | Administrator-authored, channel-by-channel instructions with channel visibility checks. |
| Instagram announcements | Planned | Detect an Instagram link shared in Discord and post the configured custom embed. |
| Leveling system | Awaiting requirements | Detailed questions will be asked before implementation. |
| Raspberry Pi deployment | Planned | Pi 3 B+ is the target; installation, performance, service setup, backups, restoration, and device hardening remain. |
| Free address and Cloudflare | Unresolved | A secure, no-subscription deployment approach still needs selecting and verification. No domain has been connected. |
| Final installation PDF | Planned for the end | Detailed illustrated Raspberry Pi instructions based on the finished release, with suitable official video links. |

## Validation completed

- The latest implementation passed **165 automated security and behavior tests**, both application type checks, and the production build.
- Local browser checks passed simulated sign-in, staff inbox enablement, reading, reviewing and sending a reply, closing a conversation, retained history, and footer navigation.
- Mobile testing at 390px width found no horizontal overflow; the tested inbox flow produced no browser errors.
- Tests used simulated Discord responses. No real credentials or member messages were used, and no live Discord messages were sent.

“Implemented” describes code and local verification, not production readiness. Live Discord authorization, command behavior and delivery, Pi resource use, public HTTPS access, backups, and recovery still need testing.

## Security and release boundaries

Implemented protections include encrypted sensitive fields, expiring server sessions, fresh Discord access checks, server isolation, request validation, CSRF/origin checks, security headers, rate limits, and safe handling of uncertain sends. Full device/deployment hardening remains unfinished.

The private staff inbox and administration activity stay on main. Reading and archiving server chat belongs on feature/message-audit and will not be merged or released until Andrew explicitly approves it. A branch separates development; it does not itself implement the audit system.

Only credential placeholders are supplied. The GitHub repository is public; real secrets, databases, backups, exports, and temporary test harnesses must stay out of it.

## Next work

Continue the core bot on main with configurable member tutorials. Develop the server chat audit separately when requested. Ask the leveling questionnaire before that feature, then complete deployment and release validation before writing the final installation PDF.

## Project records

- [Repository](https://github.com/Kindleisbest/discord-bot)
- [Audit branch](https://github.com/Kindleisbest/discord-bot/tree/feature/message-audit)
- [Detailed checkpoint](../PROJECT_PLAN.md)
- [Staff inbox screenshot — simulated data](design/inbox-verified.png)

Updated after the event milestone: the full 165-test suite, typechecks, and build passed during event development. Browser checks use simulated Discord, including failed-announcement recovery.
