# Leveling implementation checkpoint

Updated 22 September 2026. The feature is under construction. Its approved behavior is recorded in [the questionnaire](LEVELING_QUESTIONNAIRE.md).

## Implemented foundation

- Exact progression calculations use bigint for XP and levels. Each advance costs `10 * newLevel²`; there is no fixed maximum earned level. The XP-to-level lookup uses logarithmic search. Convert values to decimal strings for JSON and future database records.
- Separate website grants are registered as `leveling.view`, `leveling.adjust`, and `leveling.manage`. The existing permission editor can delegate them using its current protections: Discord login plus current Administrator permission or ownership, server isolation, and higher-role control of lower roles. General settings access does not imply any leveling grant, and no leveling grant makes a member the owner.
- Encrypted per-server settings storage supports optimistic revisions, transactional administration activity, and encrypted reasons for changes. The runtime initializes it, prunes old reasons, and removes its records when the bot leaves a server. Settings are configuration and do not expire after 90 days; reasons do.
- Encrypted member persistence holds exact decimal XP totals, a shared earning cooldown, enrollment state, departure expiry, and opt-out preferences. Award processing and duplicate prevention are transactional. This is an internal storage API; there is still no live activity listener or member command.

The settings store is an internal persistence layer. No leveling settings HTTP route or website editor is available yet. Calling the store does not prove authorization or that a configured Discord channel/role exists. Those checks belong in the future service and HTTP layer before a save reaches storage.

## Settings contract

Defaults match Andrew's choices: enabled, 10 XP per award, a shared 30-second cooldown, no channel/category or role exclusions, no reward milestones, no announcement destination, and no announcement ping. **There is no daily XP cap.** Enabling is a saved preference for the completed earning feature; this foundation does not attach listeners or award XP.

Channel/category exclusions share one list of IDs. The future eligibility checks must expand current category/channel ancestry, including threads and forum posts. Role exclusions use a separate list. Reward milestones pair an exact decimal level string with a Discord role ID; role ownership and automatic reconciliation are later work.

Implementation bounds limit the size of configuration requests, independently of earned levels: 1–1,000,000 XP per award; 1–86,400 seconds per cooldown; at most 500 excluded channel/category IDs, 250 excluded role IDs, and 100 milestones. A configured milestone level is a positive canonical decimal string of up to 100 digits. Lists cannot contain duplicates; a role or level cannot appear twice in milestones. IDs must be 17–20 decimal digits. Saves require an expected revision and a nonblank reason of up to 500 characters. Unknown fields, including a daily-cap field, are rejected. These are input/resource bounds, not claims about Pi capacity or a maximum earned level.

Settings encryption authenticates the server, revision, and update timestamp. A missing record gets fresh defaults; a corrupt record fails closed. A stale revision returns a conflict. Settings, the encrypted reason, and ordinary administration activity are saved in one transaction; a failure rolls back all of them. Raw reasons are not copied into ordinary activity. Reasons are deleted at exactly 90 days when cleanup runs; there is no reason-reading endpoint in this stage.

## Member persistence contract

Enrollment must be established by a future service after checking current Discord membership. An event cannot enroll an unknown, departed, or expired member. Ordinary joins preserve active progress and never cancel an opt-out. Leaving blocks earning immediately and retains progress for 30 days from the first recorded departure; repeated leave notifications do not extend that period. A return before expiry restores progress and the last award time. At the exact expiry boundary, reads stop returning the departed record even if scheduled cleanup has not run; rejoining starts fresh. Rejoining also starts a new enrollment time to reject delayed events from a prior membership.

Opt-out deletes the stored XP and cooldown history and retains a minimal opt-out preference. Joining again does not resume earning; an explicit opt-in starts fresh. Temporary hashed duplicate-prevention receipts remain until their original expiry so opt-out/opt-in cannot award the same reaction again. They contain identifiers and expiry metadata, not message text or XP totals. The future member-facing opt-out service must also remove proven bot-assigned leveling reward roles; this persistence stage does not perform Discord role actions or claim the complete opt-out command is available.

Awards use the currently saved enabled state, XP amount, and shared cooldown in the same database transaction as the total update and duplicate receipt. All sources share the same member/server cooldown. An event rejected during the cooldown is still consumed, so replaying it later cannot earn XP. There is no daily cap. Disabled, inactive, stale, or over-capacity work earns nothing; storage limits never evict live receipts to make another award possible. An encryption/storage failure rolls back both the receipt and the XP change.

The internal event contract requires a source, a canonical event identifier, an occurrence timestamp, and a source-creation timestamp. It rejects unknown fields, including message bodies. The future collector must derive those values from trusted Discord events: message identity once for messages/replies/forum openings, message plus reactor identity for received reactions regardless of emoji, and a stable interval identity for voice. Event keys are hashed with the server and source; changing the recipient cannot replay an event. This API alone does not prove that a human was eligible, that channel/role exclusions passed, or that voice attendance conditions were met.

Events must be less than five minutes old, cannot be from the future, and must occur after enrollment. Received reactions must refer to a message younger than 30 days; their receipts expire at that message's 30-day boundary. Other receipts expire after 24 hours. Freshness checks prevent an old event from earning again after its receipt is pruned. A new reaction on an eligible old message may qualify after joining; the reaction's occurrence time, rather than the message's creation time, is compared with enrollment. Clock regression cannot rewind member state or reopen earning early.

Default capacity guards are 5,000 member/preference records per server and 20,000 total, plus 20,000 duplicate receipts per server and 100,000 total. These are storage protections, not measured supported populations. Existing members can still leave or opt out at capacity; new admissions fail clearly. Expired records are cleaned at startup and hourly, and guild removal deletes that guild's member records and receipts. Member payloads use authenticated encryption; invalid/corrupt records fail closed rather than replacing XP with zero. Totals use exact decimal strings and bigint arithmetic; a 4,096-digit record guard bounds corrupt input without introducing a practical maximum earned level.

## Remaining work

1. Member services and live membership lifecycle integration, including safe handling of missed leave/rejoin events during downtime. Add authorized XP adjustments, reason history, owner-only full reset, and all-time leaderboard queries. Storage primitives alone do not establish current Discord membership.
2. Settings service, live Discord role/channel validation, protected HTTP routes, and an accessible editor. Staff reasons must be recorded; full-server reset must check ownership separately from grants.
3. Approved message/reply/forum, received-reaction, and group-voice intake. Reactions qualify only on messages up to 30 days old. Poll votes and event RSVPs remain deferred for a later conversation.
4. Role delivery and reconciliation that manage only bot-assigned roles, level-up announcements, private readable commands, and all-time leaderboard.
5. End-to-end and accessibility checks, then real Discord and Pi performance/deployment validation. Expected server/member population is unknown, so supported capacity is not yet established.

Server-chat auditing remains separate on `feature/message-audit`. This work adds no audit collector, new gateway intent, or member activity listener.

## Validation

All 285 automated tests, both typechecks, and the production build pass. Sixteen member-storage tests cover exact huge XP totals, shared cooldowns, no daily cap, duplicate/replay protection, opt-out and rejoin boundaries, expired records, capacities, disk reopen, wrong keys, metadata corruption including expiry tampering, clock regression, and rollback after partially completed writes. Ten settings tests and four permission/HTTP tests cover configuration persistence and protected delegation. Cleanup authenticates records before deletion and processes at most 500 records per batch. No new leveling page or browser flow was added or visually validated. Live Discord/Pi verification remains outstanding.
