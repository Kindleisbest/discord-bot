# Leveling implementation checkpoint

Updated 21 September 2026. The feature is under construction. Its approved behavior is recorded in [the questionnaire](LEVELING_QUESTIONNAIRE.md).

## Implemented foundation

- Exact progression calculations use bigint for XP and levels. Each advance costs `10 * newLevel²`; there is no fixed maximum earned level. The XP-to-level lookup uses logarithmic search. Convert values to decimal strings for JSON and future database records.
- Separate website grants are registered as `leveling.view`, `leveling.adjust`, and `leveling.manage`. The existing permission editor can delegate them using its current protections: Discord login plus current Administrator permission or ownership, server isolation, and higher-role control of lower roles. General settings access does not imply any leveling grant, and no leveling grant makes a member the owner.
- Encrypted per-server settings storage supports optimistic revisions, transactional administration activity, and encrypted reasons for changes. The runtime initializes it, prunes old reasons, and removes its records when the bot leaves a server. Settings are configuration and do not expire after 90 days; reasons do.

The settings store is an internal persistence layer. No leveling settings HTTP route or website editor is available yet. Calling the store does not prove authorization or that a configured Discord channel/role exists. Those checks belong in the future service and HTTP layer before a save reaches storage.

## Settings contract

Defaults match Andrew's choices: enabled, 10 XP per award, a shared 30-second cooldown, no channel/category or role exclusions, no reward milestones, no announcement destination, and no announcement ping. **There is no daily XP cap.** Enabling is a saved preference for the completed earning feature; this foundation does not attach listeners or award XP.

Channel/category exclusions share one list of IDs. The future eligibility checks must expand current category/channel ancestry, including threads and forum posts. Role exclusions use a separate list. Reward milestones pair an exact decimal level string with a Discord role ID; role ownership and automatic reconciliation are later work.

Implementation bounds limit the size of configuration requests, independently of earned levels: 1–1,000,000 XP per award; 1–86,400 seconds per cooldown; at most 500 excluded channel/category IDs, 250 excluded role IDs, and 100 milestones. A configured milestone level is a positive canonical decimal string of up to 100 digits. Lists cannot contain duplicates; a role or level cannot appear twice in milestones. IDs must be 17–20 decimal digits. Saves require an expected revision and a nonblank reason of up to 500 characters. Unknown fields, including a daily-cap field, are rejected. These are input/resource bounds, not claims about Pi capacity or a maximum earned level.

Settings encryption authenticates the server, revision, and update timestamp. A missing record gets fresh defaults; a corrupt record fails closed. A stale revision returns a conflict. Settings, the encrypted reason, and ordinary administration activity are saved in one transaction; a failure rolls back all of them. Raw reasons are not copied into ordinary activity. Reasons are deleted at exactly 90 days when cleanup runs; there is no reason-reading endpoint in this stage.

## Remaining work

1. Durable member XP storage with exact values, atomic shared cooldowns, opt-out preferences, 30-day departed-member retention, bounded deduplication, and privacy-safe deletion. No original channel message bodies belong in this storage.
2. Settings service, live Discord role/channel validation, protected HTTP routes, and an accessible editor. Staff reasons must be recorded; full-server reset must check ownership separately from grants.
3. Approved message/reply/forum, received-reaction, and group-voice intake. Reactions qualify only on messages up to 30 days old. Poll votes and event RSVPs remain deferred for a later conversation.
4. Role delivery and reconciliation that manage only bot-assigned roles, level-up announcements, private readable commands, and all-time leaderboard.
5. End-to-end and accessibility checks, then real Discord and Pi performance/deployment validation. Expected server/member population is unknown, so supported capacity is not yet established.

Server-chat auditing remains separate on `feature/message-audit`. This work adds no audit collector, new gateway intent, or member activity listener.

## Validation

All 269 automated tests, both typechecks, and the production build pass. Ten settings tests cover strict bounds, enabled/no-cap defaults, exact milestone strings, encryption and metadata substitution, server isolation, revision conflicts, rollback, 90-day reason expiry, disk reopen, wrong keys, and cleanup. Four additional permission/HTTP tests cover independent grants, protected lower-role delegation, Administrator revocation, owner access, server isolation, and CSRF/origin checks. The existing editor gains three permission labels; no new leveling page or browser flow was added or visually validated. Live Discord/Pi verification remains outstanding.
