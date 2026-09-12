# Discord Bot — Progress Report
**Updated 12 September 2026**

The secure website foundation, channel messaging, private staff inbox, event creation, member tutorials, and opt-in Instagram announcements are implemented. The project is still in development and has not been validated with a live Discord server or on the Raspberry Pi.

## Feature status

| Area | Status | What is available or remaining |
|---|---|---|
| Discord login and access | Implemented | Discord OAuth plus current Administrator permission; server owners retain access without a role. |
| Separate server workspaces | Implemented | Server selection, isolated records, role-based website permissions, and higher-role delegation. |
| Activity and channel messaging | Implemented | Latest recorded activity, message review before sending, delivery checks, and duplicate-send protection. |
| Staff DM inbox | Implemented | Per-server enablement, explicit server selection, website replies, conversation closing, and retained history. |
| Staff message retention | Implemented | Encrypted DM content with 90-day expiry and cleanup. Attachments retain links only; those links may expire. |
| Slash commands | Implemented | /help, /dashboard, /ping, /contact, and /tutorial. Help is permission-aware. Replies are private; tutorial controls expire after ten minutes and the other command replies after two minutes. |
| Administrator walkthrough | Implemented | First-login tutorial with skip and reset. |
| Accessibility | Foundation implemented | Keyboard/focus support, labeled controls, mobile layout, reduced-motion support, and footer accessibility statement. Full accessibility validation remains. |
| Server chat audit and audit exports | Separate development branch | feature/message-audit exists locally and on GitHub. Collection, audit views/storage, and exports have not been implemented. |
| Events and graphics | Implemented; local tests pass | External, voice, and Stage event creation with announcement, optional graphic, separate results, and failed-announcement recovery. Live Discord verification remains. |
| Member /tutorial | Implemented; local tests pass | Encrypted draft/published channel instructions, private navigation, live visibility checks, clear/unpublish, and protection against conflicting edits. |
| Instagram announcements | Implemented; local tests pass | Explicit host/server enablement, selected sources and destination, custom link embeds, current permissions and audience checks, duplicate protection, and read-only 90-day outgoing history. |
| Leveling system | Awaiting requirements | Detailed questions will be asked before implementation. |
| Raspberry Pi deployment | Planned | Pi 3 B+ is the target; installation, performance, service setup, backups, restoration, and device hardening remain. |
| Free address and Cloudflare | Unresolved | A secure, no-subscription deployment approach still needs selecting and verification. No domain has been connected. |
| Final installation PDF | Planned for the end | Detailed illustrated Raspberry Pi instructions based on the finished release, with suitable official video links. |

## Validation completed

- The latest implementation passed **249 automated security and behavior tests**, both application type checks, and the production build.
- Local browser checks passed simulated sign-in, staff inbox enablement, reading, reviewing and sending a reply, closing a conversation, retained history, and footer navigation.
- Mobile testing at 390px width found no horizontal overflow; the tested inbox flow produced no browser errors.
- Instagram browser checks passed enablement, saved versus draft status, safe source/destination selection, delivery history, conflicting edits, disabling during a simulated Discord outage, retained channel IDs, keyboard navigation, and mobile layout. Desktop/mobile screenshots were visually inspected.
- Tests used simulated Discord responses. No real credentials or member messages were used, and no live Discord messages were sent.

“Implemented” describes code and local verification, not production readiness. Live Discord authorization, command behavior and delivery, Pi resource use, public HTTPS access, backups, and recovery still need testing.

## Security and release boundaries

Implemented protections include encrypted sensitive fields, expiring server sessions, fresh Discord access checks, server isolation, request validation, CSRF/origin checks, security headers, rate limits, and safe handling of uncertain sends. Full device/deployment hardening remains unfinished.

The private staff inbox and administration activity stay on main. Server-chat archiving and exports belong on feature/message-audit and will not be merged or released until Andrew explicitly approves it. Optional Instagram processing examines selected new messages for links without archiving original message bodies. A branch separates development; it does not itself implement the audit system.

Only credential placeholders are supplied. The GitHub repository is public; real secrets, databases, backups, exports, and temporary test harnesses must stay out of it.

## Next work

Ask the detailed leveling questionnaire before implementing that feature. Develop the server chat audit separately when requested. Complete deployment and release validation before writing the final installation PDF. The owner-only Pi Party Easter egg remains planned, with no implementation yet.

## Project records

- [Repository](https://github.com/Kindleisbest/discord-bot)
- [Audit branch](https://github.com/Kindleisbest/discord-bot/tree/feature/message-audit)
- [Detailed checkpoint](../PROJECT_PLAN.md)
- [Staff inbox screenshot — simulated data](design/inbox-verified.png)
- [Member tutorial screenshot — simulated data](design/tutorial-verified.png)
- [Instagram posting and history screenshot — simulated data](design/instagram-posting-verified.png)
- [Instagram setup, limits, and remaining live verification](INSTAGRAM_CHECKPOINT.md)
- [Leveling requirements questionnaire](LEVELING_QUESTIONNAIRE.md)

Instagram remains disabled until both the host and an authorized server administrator explicitly enable it. Posts use canonical links and custom text; Instagram media and captions are not fetched. Delivery can be skipped for permission, workload, rate, or capacity limits, and uncertain sends are never automatically replayed.
