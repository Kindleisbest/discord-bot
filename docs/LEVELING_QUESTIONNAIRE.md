# Leveling requirements — awaiting Andrew's answers

Prepared 12 September 2026. Leveling is not implemented. Andrew requested detailed questions before implementation. Answers may come in batches; “please suggest a default” is a valid answer. These choices remain unset until agreed. Existing Discord login, Administrator/owner access, server isolation, and security requirements still apply.

## First round: core behavior

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

## Follow-up detail after the core choices

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

No XP formula, retention period, reward action, channel collector, or leveling command is authorized by an unanswered option in this document. Once the requirements are agreed, record the chosen behavior and implement one bounded part at a time. Avoid archiving original channel message text; the message-audit feature stays separate on its existing branch. Progress exports, if chosen, concern leveling records and do not activate chat-audit exports.
