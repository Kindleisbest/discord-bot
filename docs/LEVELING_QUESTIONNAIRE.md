# Leveling requirements — confirmed choices and remaining questions

Prepared 12 September 2026; updated 21 September 2026. Andrew requested detailed questions before implementation. The progression formula, encrypted settings storage, and separate permission grants are implemented; member XP storage, earning, rewards, commands, and the settings editor are not implemented yet. See [the implementation checkpoint](LEVELING_CHECKPOINT.md). Unanswered product choices remain unset. Existing Discord login, Administrator/owner access, server isolation, and security requirements still apply.

## Confirmed so far

- Reward interactive participation, including sending messages, replying, and receiving reactions on a member's messages.
- Giving a reaction must not earn XP for the person giving it; Andrew wants to avoid rewarding reaction spam.
- Staff need safeguards and the ability to disable XP earning in selected channels.
- **Start leveling enabled with the agreed defaults in each server**, as explicitly chosen on 21 September. Staff can pause it and configure exclusions. This is the intended behavior once the earning feature ships; the isolated math implementation does not activate collection or earn XP.
- Andrew clarified the scope as any activity that keeps people engaged in the server. Plan broadly for participation signals Discord exposes, instead of repeatedly asking Andrew to enumerate activity types. **Poll-vote and event-RSVP XP are deferred at Andrew's request: ask again later, and do not enable them now.** Event voice participation uses the ordinary voice rules without a second award.
- **All new human messages qualify**, including replies, emoji-only messages, links, and attachments, subject to the shared cooldown and exclusions. Edits do not earn extra XP, and a forum opening counts once. No message-content length/repetition filter was selected. Ignore bots and webhook/system messages; slash-command interactions do not create a new human chat message and are not a separate earning source.
- Andrew chose **simpler shared controls for all activities**: one common XP amount and cooldown, with channel/role exclusions, rather than separate numeric controls for each activity. Approved starting defaults are **10 XP per eligible award and one shared 30-second cooldown across activities, with no daily XP cap**. The 21 September answer explicitly replaces the earlier 1,200 XP/day choice; no daily-reset time or time zone is needed. Voice earning must use the same award opportunity rather than bypassing the shared cooldown.
- Every successive level should be harder to earn: increase the XP needed for each next level. Level 1 can take roughly 30 seconds of participation. Andrew explicitly clarified that **advancing from level 19 to level 20 alone should take about a week** of regular participation, and accepted the quadratic curve below. These are approximate activity-dependent pacing targets.
- Levels should continue **indefinitely**, with no fixed maximum level. Reward milestones must not impose a level cap. Plan numeric storage and progress calculations to avoid overflow or expensive work as totals increase.
- Staff choose level-to-role reward milestones. A newly earned reward replaces earlier leveling reward roles; reward roles do not accumulate. **Automatically update rewards after staff reduce XP or change milestone settings**, matching the member's current level. Manage **only reward roles this bot assigned** and preserve manually assigned roles. Track assignment provenance; uncertain role actions must not be treated as proven ownership. Failed role changes need bounded recovery and visible status in the delivery stage.
- Level-up announcements go to a channel selected by staff. Staff can choose whether to ping the member; default to no ping. Announcement wording and handling multiple levels gained at once remain unset.
- Approved starting anti-spam policy: ignore bots and self-reactions; a reacting person can contribute at most one reaction award per message; removing and re-adding reactions gives no additional award; messages and replies share the earning cooldown with other activities; staff can adjust the shared XP amount and cooldown. Reactions qualify only on messages **up to 30 days old**. **Keep earned XP if the message or reaction is later deleted**; staff can correct abuse manually.
- Members can use a private command to opt out of earning XP and appearing on the leaderboard. **Opting out deletes their XP and removes their leveling reward role.** Clearly explain those effects before confirmation; retain only the minimal preference needed to honor the opt-out.
- Keep progress for **30 days after a member leaves**, then delete it. Rejoining within the retention period preserves the unexpired progress.
- Voice XP requires at least two eligible humans together in the channel. Exclude AFK and deafened time. Muted members can still earn while listening; connection state is the available signal, not proof of attention.
- Staff can exclude entire channel categories and individual channels. Exclusions apply to their child threads and forum posts.
- Authorized staff can add/remove XP, reset an individual member, and pause earning. Only the server owner can reset everyone. These administrative changes require a reason and are recorded in administration activity without message bodies.
- Website access has **three separate leveling permissions**: view leveling records, adjust member XP, and manage leveling settings/rewards. Existing higher-role delegation rules and the Discord Administrator/owner access gate still apply. A settings grant must not implicitly grant XP adjustments or the owner-only server reset.
- `/rank`, `/leaderboard`, `/rewards`, and private XP opt-out controls should all reply privately to the invoking member. Use readable text embeds for rank information; graphic rank cards are not requested.
- The leaderboard is **all-time only**. Do not add weekly/monthly boards, seasonal resets, or a daily-cap reset scheduler.
- Start fresh, with no existing XP/level import required.

See [activity feasibility and counting rules](LEVELING_ACTIVITY_SCOPE.md) for available Discord signals and their limits. Andrew is unsure of expected server/member scale; proceed with bounded processing and validate capacity on the Pi instead of inventing a supported population. Polls and RSVPs are explicitly postponed, not rejected; revisit them after the core earning feature is ready for review. Do not interpret silence as choosing values or enabling every candidate signal. Progress exports have not been requested for leveling and are outside the first stage.

## Approved numeric defaults

Andrew accepted 10 XP per eligible award and one shared 30-second earning cooldown. His latest answer removes the daily cap. The XP required to advance into level `n` is `10 × n²`; cumulative XP to reach level `n` is `10 × n(n + 1)(2n + 1) / 6`. This keeps each step harder and has no fixed maximum level. Use exact integer arithmetic for levels, XP, and threshold calculations; never convert growing totals to floating-point numbers. Inverting total XP must use logarithmic search rather than iterating through every prior level.

| Advance into level | XP for that single advance | Qualifying earning time at one award per 30 seconds |
|---|---:|---:|
| 1 | 10 | About 30 seconds |
| 2 | 40 | About 2 minutes |
| 5 | 250 | About 12.5 minutes |
| 10 | 1,000 | About 50 minutes |
| 15 | 2,250 | About 112.5 minutes |
| 20 | 4,000 | About 200 minutes |

For the level 19-to-20 step, earning 600 XP a day (60 eligible awards over roughly 30 minutes of qualifying earning intervals) would take about 6.7 days. This is a modeling assumption, not a measurement of normal server behavior. Receiving reactions, voice eligibility, exclusions, shared cooldowns, and actual participation affect results. An instantaneous first eligible message may earn its award immediately; the table expresses nominal earning intervals, not forced waits or automatic elapsed-time promotions. The entire journey to level 20 is 28,700 XP, about 47.8 days at 600 XP/day. Andrew accepted this example pace. With no daily cap, more active members can progress faster; a week is not a mandatory wait.

## Original discussion checklist (historical questions, not a list of unanswered choices)

The confirmed choices above supersede these prompts, including the removed daily cap. Keep this checklist as a record of the detailed discussion; do not ask already answered questions again. Unanswered presentation details can use ordinary accessible defaults when their implementation stage begins. Ask about material behavior before adding it.

### First round: core behavior

1. Should members earn XP from text messages, time in voice channels, both, or another activity?
2. Should each server have entirely separate levels and settings? Should leveling start disabled until an administrator enables it?
3. Which channels should count: an allowlist, all except an exclusion list, or another rule? Should private channels, threads, forums, and announcement channels count?
4. Should staff and the server owner earn XP? Should certain roles be excluded or receive different XP rates?
5. For text, should XP be fixed or random per eligible message, and how much? Should links, attachments, emoji-only messages, commands, and short messages count?
6. What cooldown, repeated-message rule, and daily XP limit should prevent spam? Should deleted messages lose previously awarded XP?
7. If voice XP is wanted, should members earn it when alone, muted, deafened, streaming, or in the AFK channel? How should earning time be rounded?
8. What should a level represent in practice: roughly how long should an active member take to reach levels 5, 10, and 25?
9. Should the maximum level be capped? Should XP ever decay for inactivity or reset for a new season?
10. Should reaching a level grant a Discord role? What level-to-role milestones do you want?
11. Should earned roles accumulate, or should each new reward replace earlier level roles? What happens to reward roles if XP is reduced?
12. Should level-ups be announced publicly, sent privately, or remain silent? Which channel should announcements use, and should they mention the member?
13. Which member commands do you want: personal rank, another member's rank, leaderboard, rewards, XP rules, or others? Should replies be private or public?
14. Should members be able to opt out? Should opting out stop earning, hide them from leaderboards, delete their progress, or offer separate choices?
15. What should happen to progress when a member leaves and rejoins? How long should inactive member records remain?
16. Should administrators be able to add/remove XP, change levels, reset one member, reset the server, or pause earning?
17. Should viewing XP, changing XP, configuring rewards, and resetting data have separate website permissions? Which actions should only the owner perform?
18. Is there existing XP/level data to import? If so, which bot or format? Do you want progress exports?

### Follow-up detail after the core choices

19. What name should the feature, XP unit, and level ranks use?
20. Do different channel categories or roles need XP multipliers? If several multipliers apply, should only the largest apply?
21. Should text and voice share one XP total or have separate totals and leaderboards?
22. Should boosts, event attendance, reactions, invitations, or staff awards affect XP? Each additional source needs its own abuse rules before implementation.
23. Should content edits ever award XP? How should duplicate/repeated messages across different channels be treated?
24. Should voice require at least two qualifying human participants? What happens when a participant becomes AFK or changes eligibility mid-session?
25. What daily-limit reset time and time zone should be used, if a daily limit is wanted?
26. Should leaderboards be all-time, weekly, monthly, seasonal, or selectable? Does a period reset the underlying level or only the displayed competition?
27. May members inspect another member's XP? How should private-channel XP and opt-out choices affect public display?
28. Should rank responses use text, optional image cards with a complete text equivalent, or both? What visual theme or wording do you want?
29. Should reaching several milestones at once produce one announcement or several? What should happen when reward delivery fails?
30. When reward rules change, should existing members receive the updated rewards automatically, only after approval, or only on their next level-up?
31. Should manually assigned reward roles be preserved? What should happen if an administrator deletes or renames a configured reward role?
32. Should XP adjustments require a reason and appear in administration activity without retaining member message bodies?
33. What confirmation should a member reset, server reset, import, or bulk reward update require?
34. Should XP adjustments and deleted progress be reversible? If so, for how long and who may restore them?
35. Should members have a private progress-deletion command, and what should happen to earned roles after deletion?
36. Roughly how many servers, members, daily messages, and simultaneous voice users will the Pi 3 B+ serve?

## Implementation boundary

Unanswered options do not authorize reward actions, channel collectors, or leveling commands. Implement already agreed, independent pieces in bounded stages, beginning with pure progression calculations and tests. Remaining questions must not silently turn into enabled features. Avoid archiving original channel message text; the message-audit feature stays separate on its existing branch. Progress exports, if chosen later, concern leveling records and do not activate chat-audit exports.

### Implementation sequence

1. **Complete:** exact progression calculations in `shared/leveling.ts` and six focused tests in `tests/leveling.test.ts`, with no live activation. The full 255-test suite, both typechecks, and production build pass on 21 September 2026.
2. **In progress:** encrypted per-server settings persistence and separate view/adjust/manage grants are implemented. Settings routes/editor and fresh Discord channel/role validation remain, as do durable exact member XP, opt-out preferences, departure retention, and atomic shared cooldown enforcement. Validate numeric input sizes before arbitrary-precision arithmetic. Serialize XP and levels as decimal strings in storage/API contracts.
3. Approved message/reply/forum, received-reaction, and group-voice intake with bounded queues, deduplication, fresh eligibility checks, and restart/reconnect handling. No poll/RSVP listeners or message-body archive.
4. Bot-owned reward-role reconciliation and level-up announcements, including permission/hierarchy checks and failure recovery that never claims uncertain role ownership.
5. Private readable member commands and accessible website controls, including reasons for administrative actions, owner-only server reset, and destructive-action confirmation.
6. Simulated end-to-end/accessibility checks, followed by real Discord and Pi performance validation during deployment. Revisit the deferred poll/RSVP choices with Andrew.
