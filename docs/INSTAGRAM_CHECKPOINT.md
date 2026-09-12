# Instagram announcements — first implementation checkpoint

The URL recognizer is implemented and tested. It is not connected to the bot gateway yet and does not send announcements, read Discord channels, fetch Instagram, or store messages.

## Supported input

- Explicit HTTPS links on exactly `instagram.com` or `www.instagram.com`.
- Post `/p/` and reel `/reel/` paths with a 1–64 character ASCII shortcode (letters, digits, underscore, or hyphen).
- Optional trailing slash, query, and fragment. Canonical links use HTTPS and `www.instagram.com`, preserve shortcode case, and remove tracking queries/fragments.
- Plain links, Discord angle brackets, and Markdown link destinations; common sentence punctuation is ignored at the end.
- Duplicate shortcodes within a message are combined, including post/reel aliases. The first encountered link is retained.

This is a deliberately limited supported format, not validation that a post exists or is public. Profile/story links, short links, credentials, explicit ports, encoded paths, dot segments, lookalike hosts, and non-HTTPS links are rejected. No redirect is followed. Messages longer than 4,000 characters are rejected rather than truncated; at most ten URL candidates are examined, including invalid candidates. Individual accepted URLs are limited to 2,048 characters. Content in quotes or code is still text to this helper; it does not interpret Discord formatting beyond link wrappers.

## Next implementation step

Add per-server configuration with an off-by-default switch, selected source channels, one destination, and custom embed text. Require live Administrator/owner access and the relevant website grants. Explain any new Discord gateway intent requirement during setup. Process matching links only in enabled, explicitly configured server channels; never copy channel text into the audit system on main.

Before activation, add bot permission checks, disabled mentions, durable duplicate-send protection, bounded work, delivery status, and safe handling of uncertain sends. Decide and document who can see reposted links when source and destination permissions differ. Build the accessible editor and test the complete flow using simulated Discord before live verification. Image/caption retrieval is not part of this URL helper.

Server-chat archiving remains separate on `feature/message-audit`, subject to Andrew's release approval.
