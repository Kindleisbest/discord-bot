# Foundation setup notes — not the final installation guide

These notes enable testing of login, permissions, commands, channel messaging, and the staff DM inbox. The final multi-page illustrated Raspberry Pi guide is deliberately deferred until all features and deployment are complete. Live Discord behavior and Raspberry Pi deployment still require validation.

1. Install Node.js 24 LTS from the official Node.js distribution on a development computer. Check that the version is at least 24.14 and below 25.
2. Open a terminal in this repository. Run `npm ci`, then `npm run check`.
3. Copy `.env.example` to `.env`. Leave this file only on your computer/Pi. It is ignored by Git.
4. Open the [Discord Developer Portal](https://discord.com/developers/applications), choose **New Application**, and give the application a name. Discord's screen labels can change; screenshots will be captured for the final guide.
5. Under **General Information**, copy the Application ID into `DISCORD_CLIENT_ID`.
6. Under **OAuth2**, obtain the client secret and put it into `DISCORD_CLIENT_SECRET`. Register exactly `http://127.0.0.1:3000/auth/callback` for local compiled-site testing. The scheme, hostname, port and path must match.
7. Under **Bot**, obtain/reset the bot token and put it into `DISCORD_BOT_TOKEN`. Treat it as a password. Do not paste it into chat or GitHub.
8. Generate the encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put the entire single-line result into `DATA_ENCRYPTION_KEY`. Keep a protected recovery copy separate from the database. Do not generate a replacement key for an existing installation: losing or replacing this key makes its stored staff messages and sessions unreadable. Key rotation and backup/restore tooling are not implemented yet.
9. Install your application into a private Discord test server you own using the portal's guild install link and bot scope. Use the bot and applications.commands scopes. Grant View Channels and Send Messages only in the channels where the bot should post; do not grant the bot Administrator. The gateway requests Guilds and DirectMessages intents; leave privileged intents, including Message Content, off for this stage. Commands `/help`, `/dashboard`, `/ping`, and `/contact` are upserted when the bot connects; global command availability may take time to update.
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

DM text and attachment metadata are encrypted in the local database and expire after 90 days. Attachments remain links to Discord; files are not downloaded and links may expire earlier. Administration activity excludes message text. This stage does not collect server-channel messages or provide message exports. Tell test members about retention before enabling the inbox. Backups and copies retained in Discord have their own retention and are not erased by this application's cleanup.

If sign-in fails, check matching callback URLs, all four non-placeholder configuration values, bot installation, and your current permissions. Errors intentionally do not echo credentials. Do not solve access errors by making the site public or disabling its checks.

For the Pi 3 B+, use 64-bit Raspberry Pi OS Lite, a reliable power supply and adequate storage. Plan to build the frontend on the development computer, then run compiled files on the Pi. The exact install, service, update, backup, restore, firewall and Cloudflare steps are **not yet finalized or verified on the Pi**.
