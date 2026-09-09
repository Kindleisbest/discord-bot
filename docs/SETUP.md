# Foundation setup notes — not the final installation guide

These notes enable testing of the foundation and command/composer checkpoint. The final multi-page illustrated Raspberry Pi guide is deliberately deferred until all features and deployment are complete.

1. Install Node.js 24 LTS from the official Node.js distribution on a development computer. Check that the version is at least 24.14 and below 25.
2. Open a terminal in this repository. Run `npm ci`, then `npm run check`.
3. Copy `.env.example` to `.env`. Leave this file only on your computer/Pi. It is ignored by Git.
4. Open the [Discord Developer Portal](https://discord.com/developers/applications), choose **New Application**, and give the application a name. Discord's screen labels can change; screenshots will be captured for the final guide.
5. Under **General Information**, copy the Application ID into `DISCORD_CLIENT_ID`.
6. Under **OAuth2**, obtain the client secret and put it into `DISCORD_CLIENT_SECRET`. Register exactly `http://127.0.0.1:3000/auth/callback` for local compiled-site testing. The scheme, hostname, port and path must match.
7. Under **Bot**, obtain/reset the bot token and put it into `DISCORD_BOT_TOKEN`. Treat it as a password. Do not paste it into chat or GitHub.
8. Generate the encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put the entire single-line result into `DATA_ENCRYPTION_KEY`.
9. Install your application into a private Discord test server you own using the portal's guild install link and bot scope. Use the bot and applications.commands scopes. Grant View Channels and Send Messages only in the channels where the bot should post; do not grant the bot Administrator. This stage requests only the Guilds gateway intent. It does not require Message Content yet. Commands /help, /dashboard and /ping are upserted when the bot connects; global command availability may take time to update.
10. Run `npm run build`, then `npm start`. Open `http://127.0.0.1:3000` and select **Continue with Discord**. Use the same hostname used in the callback.
11. The owner should enter even without roles. Another account must have Discord's actual Administrator permission; a role merely named Administrator is insufficient.
12. As owner, select your server, open **Permissions**, and grant the desired website capabilities to admin roles. These settings do not alter Discord roles or bypass the Administrator gate.
13. Test logout, loss of the Administrator role, switching servers, and lower-role restrictions in the test server before considering production.

If sign-in fails, check matching callback URLs, all four non-placeholder configuration values, bot installation, and your current permissions. Errors intentionally do not echo credentials. Do not solve access errors by making the site public or disabling its checks.

For the Pi 3 B+, use 64-bit Raspberry Pi OS Lite, a reliable power supply and adequate storage. Plan to build the frontend on the development computer, then run compiled files on the Pi. The exact install, service, update, backup, restore, firewall and Cloudflare steps are **not yet finalized or verified on the Pi**.
