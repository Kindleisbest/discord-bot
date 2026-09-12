# Foundation setup notes — not the final installation guide

These notes enable testing of login, permissions, commands, channel messaging, the staff DM inbox, events, member tutorials, and optional Instagram link posting. The final multi-page illustrated Raspberry Pi guide is deliberately deferred until all features and deployment are complete. Live Discord behavior and Raspberry Pi deployment still require validation.

1. Install Node.js 24 LTS from the official Node.js distribution on a development computer. Check that the version is at least 24.14 and below 25.
2. Open a terminal in this repository. Run `npm ci`, then `npm run check`.
3. Copy `.env.example` to `.env`. Leave this file only on your computer/Pi. It is ignored by Git.
4. Open the [Discord Developer Portal](https://discord.com/developers/applications), choose **New Application**, and give the application a name. Discord's screen labels can change; screenshots will be captured for the final guide.
5. Under **General Information**, copy the Application ID into `DISCORD_CLIENT_ID`.
6. Under **OAuth2**, obtain the client secret and put it into `DISCORD_CLIENT_SECRET`. Register exactly `http://127.0.0.1:3000/auth/callback` for local compiled-site testing. The scheme, hostname, port and path must match.
7. Under **Bot**, obtain/reset the bot token and put it into `DISCORD_BOT_TOKEN`. Treat it as a password. Do not paste it into chat or GitHub.
8. Generate the encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put the entire single-line result into `DATA_ENCRYPTION_KEY`. Keep a protected recovery copy separate from the database. Do not generate a replacement key for an existing installation: losing or replacing this key makes its stored staff messages and sessions unreadable. Key rotation and backup/restore tooling are not implemented yet.
9. Install your application into a private Discord test server you own using the portal's guild install link and bot scope. Use the bot and applications.commands scopes. Grant View Channels and Send Messages only in the channels where the bot should post; do not grant the bot Administrator. The gateway requests Guilds and DirectMessages intents by default. Leave privileged intents off unless following the optional Instagram setup below. Commands `/help`, `/dashboard`, `/ping`, `/contact`, and `/tutorial` are upserted when the bot connects; global command availability may take time to update.
10. Run `npm run build`, then `npm start`. Open `http://127.0.0.1:3000` and select **Continue with Discord**. Use the same hostname used in the callback.
11. The owner should enter even without roles. Another account must have Discord's actual Administrator permission; a role merely named Administrator is insufficient.
12. As owner, select your server, open **Permissions**, and grant the desired website capabilities to admin roles. These settings do not alter Discord roles or bypass the Administrator gate.
13. Test logout, loss of the Administrator role, switching servers, and lower-role restrictions in the test server before considering production.

## Staff inbox testing

1. As the owner, select the test server and open **Staff inbox**. The inbox is disabled by default. Read the retention notice, select **Enable the staff inbox for this server**, and save the setting. The **Manage settings** website permission controls this setting.
2. For another administrator, grant **Read staff inbox** to allow conversation viewing and also **Reply to members** to allow replies and closing conversations. Both grants remain subject to the Discord Administrator requirement. The server owner already has all capabilities.
3. From a member account in the test server, use `/contact`. Its private response identifies the server and links to the bot. Send the bot a DM. Alternatively, DM the bot first, select the destination server when prompted, and then resend the message. The first message without a selected destination is not saved or forwarded.
4. Confirm that the bot's acknowledgement names the intended server. **Switch server** lets the member choose another eligible server. The selection expires after 24 hours; use `/contact` or select a server again when prompted.
5. In the website inbox, refresh the conversation list and open the member's conversation. Write a reply, choose **Review reply**, then **Send reply**. The member should receive an embed identifying the server's staff. These are live sends in your test server, so use non-sensitive test text.
6. Check the reply status. If delivery is uncertain, use the delivery check and inspect the Discord conversation before creating a new reply. The application will not automatically resend an uncertain reply.
7. Close the conversation and inspect the **Closed** list. A later accepted member message starts a new open conversation. Disable the inbox and confirm that retained history remains available while new intake and replies stop.

DM text and attachment metadata are encrypted in the local database and expire after 90 days. Attachments remain links to Discord; files are not downloaded and links may expire earlier. Administration activity excludes message text. The staff inbox does not read server-channel messages or provide message exports. Tell test members about retention before enabling the inbox. Backups and copies retained in Discord have their own retention and are not erased by this application's cleanup.

If sign-in fails, check matching callback URLs, all four non-placeholder configuration values, bot installation, and your current permissions. Errors intentionally do not echo credentials. Do not solve access errors by making the site public or disabling its checks.

For the Pi 3 B+, use 64-bit Raspberry Pi OS Lite, a reliable power supply and adequate storage. Plan to build the frontend on the development computer, then run compiled files on the Pi. The exact install, service, update, backup, restore, firewall and Cloudflare steps are **not yet finalized or verified on the Pi**.

## Testing website events

1. Give the appropriate administrator website roles both **Manage events** and **Send channel messages**, or sign in as the server owner.
2. Give the bot **Create Events**. For voice events it also needs **View Channel** and **Connect** in that voice channel. Stage events additionally need **Manage Channels**, **Mute Members**, and **Move Members** in the Stage channel. Do not grant Administrator merely to solve a missing permission.
3. In the announcement text channel, grant **View Channel**, **Send Messages**, and **Embed Links**.
4. Open **Events**, choose the location and channel, then enter a future start/end time. The form and review show your browser's time zone.
5. Optionally choose a PNG/JPEG graphic up to 1 MiB and enter its accessible description. It becomes the event cover and is included in the announcement. Upload bytes are not archived locally.
6. Review, then choose **Create event & announce**. Check the separate event and announcement results. If the event exists but its announcement definitely failed, fix the permission and use **Send missing announcement**. If delivery is unconfirmed, check Discord; do not recreate the event to resolve an uncertain response.
7. This stage creates individual events. Edit/cancel existing events in Discord. Live event/graphic delivery has not yet been verified with real credentials.

## Testing member tutorials

1. Sign in as the owner, or grant an existing Discord administrator **Edit member tutorial** for the selected server.
2. Open **Member tutorial**. The editor lists supported channels the bot can currently view: text, announcement, voice, Stage, forum, and media. Categories and individual threads are not tutorial steps. Steps follow channel position order, then channel ID; category grouping is not reproduced.
3. Select a channel. Write a heading (up to 100 characters) and instructions (up to 3,000 characters). Use **Preview step text** to check the text. Discord can render Markdown differently.
4. Leave **Publish this step** unchecked and choose **Save step** to keep a draft. Check it and save when ready. Published steps require both fields. Use **Next channel** to prepare another channel.
5. From an ordinary member account, run `/tutorial` in the test server. The bot privately shows the first published step the member and bot can both view. `/tutorial channel:` starts at a chosen published, accessible channel. Previous/Next move through the eligible steps; Close dismisses the reply. Controls expire after ten minutes, and expired replies are removed during periodic cleanup when Discord permits.
6. Confirm a draft is absent. Remove the member's View Channel access, then click a tutorial control and verify restricted guidance is no longer returned. Try a second server and confirm its tutorial is separate.
7. To withdraw guidance, uncheck **Publish this step** and save. **Clear step** removes its current saved text and unpublishes it. A warning protects unsaved edits when changing channels or leaving the editor. If another administrator saves first, copy any text you need and deliberately reload the current version.

These are authored configurations, not a copy of channel messages. They are encrypted and retained until changed/cleared or the bot is removed from the server. Clearing retains an empty revision marker to prevent stale edits restoring old text. The active database keeps at most 1,000 step records per server, including cleared and no-longer-visible channels. Backups and Discord replies have separate lifetimes. Member walkthrough progress is not stored. Live Discord validation remains outstanding.

## Testing optional Instagram announcements

1. Keep `INSTAGRAM_LINKS_ENABLED=false` for installations that do not need this feature. To test it, enable **Message Content Intent** on the application's **Bot** page in the Discord Developer Portal, set `INSTAGRAM_LINKS_ENABLED=true` in `.env`, and restart the service. Both GuildMessages and MessageContent intents are requested only with that host setting.
2. Choose two different text or announcement channels in your private test server. Their View Channel permission overrides must match for roles and members, except the bot's own direct member override. This conservative audience check can reject channels that appear to have identical members.
3. Give the bot **View Channel** and **Read Message History** in the source, plus **View Channel**, **Send Messages**, and **Embed Links** in the destination. Use a member who can view both channels.
4. As owner, or as an administrator with both **Manage Instagram** and **Send channel messages**, open **Instagram**, select the channels, and customize the embed title, description, and color. Check **Enable automatic Instagram link posting** and save. Saving configuration does not send a test message. The status above the editor reflects saved settings.
5. From the member account, send a new HTTPS Instagram post/reel link in the selected source. This triggers a real announcement when enabled. Confirm one link embed in the destination and use **Refresh status** to inspect its outgoing record. The bot does not fetch Instagram media or captions and does not archive the original message body.
6. Check that an unselected channel does not trigger posting. Change a channel's View Channel rules and confirm the next link fails safely. Restore matching rules before continuing. Events skipped because of workload or rate limits may have no delivery record.
7. Uncheck the enable switch and save; verify new links stop producing announcements. You can disable while Discord is offline and saved channel IDs are preserved. Disabling cannot recall a message already submitted to Discord.

History retains outgoing records for 90 days and shows the latest 100. Refreshing never sends or retries a post; inspect Discord directly when a result is uncertain. See the [Instagram checkpoint](INSTAGRAM_CHECKPOINT.md) for exact limits, privacy scope, and remaining live verification. The separate server-chat audit branch remains unmerged.
