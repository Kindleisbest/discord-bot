# Instagram announcements — first implementation checkpoint

The URL recognizer and per-server website settings are implemented and tested. Automatic posting is not connected to the bot gateway yet. This checkpoint does not send announcements, read Discord channel messages, fetch Instagram, or store messages.

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
