# Leveling activity scope — requirements planning

Andrew wants to reward any activity that keeps members engaged, including messages, replies, and received reactions. Giving a reaction must not earn XP. Staff need channel exclusions and safeguards. Andrew chose one shared set of XP amount, cooldown, and daily-limit controls rather than separate numeric controls per activity. Leveling remains unimplemented; the amounts, eligibility rules, progression, and rewards are still being defined.

## What Discord can report

| Participation | Available signal | Proposed counting boundary; not yet an agreed XP rule |
|---|---|---|
| Messages and replies | New message, author, channel, and reply reference | Treat a reply as one contribution; avoid counting it again merely because it references another message. |
| Forum discussions and thread replies | Thread creation plus the opening message; later messages | Avoid awarding twice for a forum's opening contribution. |
| Reactions received | Reaction event identifies reactor and message; message author may be included | Award the message author, never the reactor. Verify the author when absent from the event. Ignore self/bot reactions and prevent remove/re-add farming. |
| Group voice participation | Channel membership and connection-state changes | Reward eligible time together, without claiming it proves speaking, listening, or attention. Minimum participant count, mute/AFK eligibility, and award interval remain open. |
| Poll participation | Vote-add/remove events, including answer identity | Count a person/poll once, rather than each answer or re-vote. Whether vote removal reverses XP remains open. |
| Server-event interest | Event subscription/unsubscription | This records interest or RSVP, not actual attendance. Do not label it attendance XP. Whether an RSVP deserves XP remains open. |
| Time in an event's voice channel | Voice presence during an associated event | A possible participation proxy, not proof of attending or paying attention. Avoid also awarding ordinary voice XP for the same interval. External event attendance is not verified by these signals. |

Message/reply structure and forum creation are documented in Discord's [message object](https://docs.discord.com/developers/resources/message#message-object) and [forum/media thread creation](https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel). Reaction events can omit the author ID; see [reaction additions](https://docs.discord.com/developers/events/gateway-events#message-reaction-add) and [single-message retrieval requirements](https://docs.discord.com/developers/resources/message#get-channel-message).

[Voice state](https://docs.discord.com/developers/resources/voice#voice-state-object) describes connection and mute/deafen/streaming state. Speaking information belongs to the separate [voice connection protocol](https://docs.discord.com/developers/topics/voice-connections#speaking). This plan does not propose recording audio or monitoring what members say. Discord also documents [poll vote events](https://docs.discord.com/developers/events/gateway-events#message-poll-vote-add) and [scheduled-event subscriptions](https://docs.discord.com/developers/events/gateway-events#guild-scheduled-event-user-add).

## Shared controls and unresolved safeguards

- Keep one shared XP amount, cooldown, and daily cap in the website, as requested. Set channel and role exclusions centrally. Their initial values, reset time zone, and exact interaction across activity types still need answers.
- Treat related Discord events as one contribution where appropriate. Replies and forum openings should not accidentally gain duplicate XP. This is a proposed counting rule, not a finalized reward formula.
- Received-reaction rewards need bounds against coordinated farming even though reactors earn nothing. Decide the author/recipient cooldown behavior, unique-reactor rules, reversals, and daily cap before implementation.
- Channel exclusions need to apply consistently to message, reaction, poll, and voice signals. Decide inheritance into threads, forum posts, and categories. Excluding a channel should not require storing its message bodies.
- Text content is unnecessary merely to count message events. Detecting short or repeated text may require additional temporary processing and Message Content access. Do not add chat archiving; it remains on the separate audit branch.
- A countable event is not proof of useful engagement. Do not describe presence, RSVPs, emoji choices, or repeated contributions as verified attention or attendance.

## Implementation prerequisites

Possible guild intents include `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, `GUILD_VOICE_STATES`, `GUILD_MESSAGE_POLLS`, and `GUILD_SCHEDULED_EVENTS`. Text-based safeguards may additionally need privileged `MESSAGE_CONTENT`. These are feasibility notes, not a request to enable every intent now. Check the selected feature set against Discord's [Gateway intent requirements](https://docs.discord.com/developers/events/gateway#gateway-intents) when implementation begins.

Design for bounded memory/storage and rate-limited processing on the Pi 3 B+. Restart/reconnect behavior, deduplication retention, member opt-out, progress deletion, role rewards, and administrator adjustments are still unresolved. Existing OAuth plus Administrator/owner checks and per-server website grants remain mandatory. The final specification will combine these decisions before code is added.
