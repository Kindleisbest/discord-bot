# Instagram announcements — first implementation checkpoint

The URL recognizer, per-server website settings, and durable delivery-record foundation are implemented and tested. Automatic posting is not connected to the bot gateway yet. This checkpoint does not send announcements, read Discord channel messages, fetch Instagram, or store messages.

## Supported input

- Explicit HTTPS links on exactly `instagram.com` or `www.instagram.com`.
- Post `/p/` and reel `/reel/` paths with a 1–64 character ASCII shortcode (letters, digits, underscore, or hyphen).
- Optional trailing slash, query, and fragment. Canonical links use HTTPS and `www.instagram.com`, preserve shortcode case, and remove tracking queries/fragments.
- Plain links, Discord angle brackets, and Markdown link destinations; common sentence punctuation is ignored at the end.
- Duplicate shortcodes within a message are combined, including post/reel aliases. The first encountered link is retained.

This is a deliberately limited supported format, not validation that a post exists or is public. Profile/story links, short links, credentials, explicit ports, encoded paths, dot segments, lookalike hosts, and non-HTTPS links are rejected. No redirect is followed. Messages longer than 4,000 characters are rejected rather than truncated; at most ten URL candidates are examined, including invalid candidates. Individual accepted URLs are limited to 2,048 characters. Content in quotes or code is still text to this helper; it does not interpret Discord formatting beyond link wrappers.

## Website settings

Open Instagram after selecting a server. Viewing requires Manage Instagram; saving also requires Send channel messages, with the usual live Discord Administrator/owner gate. Choose up to 25 text/announcement source channels, a different destination, and a title, optional description, and hex color. Incomplete setups may be saved. Unavailable saved channel IDs remain visible until explicitly removed or replaced. Settings are encrypted, isolated per server, and protected by revision checks against concurrent overwrites. They persist until replaced or the bot is removed; the 90-day message retention limit does not apply to active configuration.

The website clearly labels this as setup only. There is no enable control, every returned configuration is disabled, and requests cannot enable posting. Saving never sends a test message. The preview shows static authored text and color; it does not substitute placeholders or retrieve post images/captions.

## Next implementation step

Implement the controlled gateway and delivery flow, then add an explicit off-by-default enable switch. A future update must not silently activate saved setups. Explain any new Discord gateway intent requirement during setup. Process matching links only in enabled, explicitly configured server channels; never copy channel text into the audit system on main.

Before activation, add bot permission checks, disabled mentions, durable duplicate-send protection, bounded work, delivery status, and safe handling of uncertain sends. Decide and document who can see reposted links when source and destination permissions differ. Build the accessible editor and test the complete flow using simulated Discord before live verification. Image/caption retrieval is not part of this URL helper.

Server-chat archiving remains separate on `feature/message-audit`, subject to Andrew's release approval.

## Durable delivery records

The internal delivery store is ready for the future sender. A server/source-message/shortcode identity reserves one job atomically. Repeated copies of the same event retain the original destination and outgoing payload, even if settings change. Separate messages sharing the same Instagram post remain separate events; cross-message spam limits still belong in the gateway stage.

Outgoing URL/text and routing/author identifiers are encrypted and authenticated to the server, job ID, timestamp, and record format. Only canonical tracking-free Instagram URLs are kept. This is an outgoing announcement record, not an archive of the original channel message. No gateway or sender currently calls the reservation function.

Pending reservations become uncertain on startup. Sent, failed, and uncertain jobs cannot be reopened by this store or automatically replayed. The eventual sender must commit the reservation before posting and treat any failure to confirm or persist delivery as uncertain. Missing or unreadable storage must never be bypassed. Failed delivery is deliberately not retried by this checkpoint.

Jobs expire locally at 90 days and are pruned on startup/hourly, with removal when the bot leaves a server. Retained jobs are capped at 1,000 per server and 10,000 overall, counting all statuses; new work is refused instead of evicting duplicate protection. Lists return at most 100 jobs. Cleanup does not delete Discord posts or backups.

New reservations accept source message IDs from the last five minutes and reject IDs over one minute in the future. This prevents old event replays being accepted after retention cleanup. Delayed events outside that window will be skipped, and the Pi needs an accurate clock. The age check uses [Discord's documented snowflake timestamp](https://docs.discord.com/developers/reference#snowflakes); it does not prove server membership, channel access, or event authenticity. Those checks remain mandatory in the gateway/sender.

Validation: 223 automated tests and the production build pass, including actual database close/reopen, uncertainty recovery, encrypted record tampering, stale-event expiry, capacity limits, and immutable terminal states. Live delivery remains untested and inactive.
