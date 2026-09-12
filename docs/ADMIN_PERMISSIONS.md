# Administrator permissions guide
Updated 11 September 2026 for the current development version.

## Entering the website

Sign in through Discord and select a server. The bot must be installed there, and your account must either own the server or currently have Discord's actual **Administrator** permission. A role named “Administrator” is not sufficient by itself.

The server owner receives every website permission, even without a role. Other administrators initially receive **View activity**. Their additional website permissions come from their current Discord roles. Grants from multiple roles combine.

These website profiles limit access to this dashboard. Discord Administrator still grants broad powers within Discord itself. Giving someone a website permission does not give them a Discord role or bypass the login requirement.

## Which website permissions are needed?

| Action | Required website permissions |
|---|---|
| Read latest administration activity | View activity; included for admitted administrators |
| Send a message to a server channel | Send channel messages |
| Check a channel-message delivery | Send channel messages; the delivery must be your own, unless you are the server owner |
| Read staff conversations and reply-delivery records | Read staff inbox |
| Reply to a member or close a conversation | Read staff inbox **and** Reply to members |
| Enable or disable staff DMs | Manage settings |
| View event requests and event-delivery results | Manage events |
| Create an event with its announcement | Manage events **and** Send channel messages |
| Send a confirmed event's missing announcement | Manage events **and** Send channel messages |
| Write, publish, unpublish, or clear channel instructions | Edit member tutorial |
| View Instagram setup | Manage Instagram |
| Save Instagram channels and embed setup (posting unavailable) | Manage Instagram **and** Send channel messages |
| Change eligible lower roles' website access | Manage lower roles, subject to the rules below |
| Skip or reset your administrator walkthrough | Any signed-in administrator; this only changes your own progress |

Manage settings does not automatically allow reading private conversations. Reply to members alone does not allow reading, replying, or closing them.

## First setup as the server owner

1. Sign in with the account that owns the Discord server.
2. Select the correct server using the Server menu.
3. Open **Permissions** and choose an existing Discord role.
4. Select the website permissions its administrators need, then save.
5. Repeat for other roles. Permissions are configured separately in each server.
6. If a trusted senior administrator should delegate access, grant **Manage lower roles** along with the permissions that person should be able to delegate.
7. Have each administrator sign in using their own Discord account and check the actions intended for them.

Example website profiles for accounts that already meet the Administrator requirement:

| Example responsibility | Website grants |
|---|---|
| Review staff requests | Read staff inbox |
| Respond to staff requests | Read staff inbox + Reply to members |
| Manage inbox availability | Manage settings |
| Send channel announcements | Send channel messages |
| Organize events and announcements | Manage events + Send channel messages |
| Maintain member onboarding instructions | Edit member tutorial |
| Delegate selected access | Manage lower roles + the specific capabilities they may delegate |

These are examples, not automatically created roles.

## What a delegated permission manager can change

A non-owner manager can edit only roles strictly below their highest Discord role. They cannot edit a role they hold, @everyone, an integration-managed role, or an equal/higher role. Equal-position roles are deliberately treated as protected.

They can grant only website permissions they already have. If a target role already has a permission outside the manager's own access, that role is protected from replacement or removal by that manager. The server owner or an appropriately privileged higher administrator must make the change.

The server owner can edit website grants for every existing role. This still does not change Discord role membership or the website's Administrator requirement.

## Website access and bot permissions are separate

Your website grant authorizes an action through the dashboard. The bot must also have the Discord permissions needed to carry it out.

- Channel messages: View Channel and Send Messages in the chosen channel.
- Event announcements: View Channel, Send Messages, and Embed Links.
- External events: Create Events at server level.
- Voice events: Create Events, View Channel, and Connect in the selected voice channel.
- Stage events: Create Events, View Channel, Manage Channels, Mute Members, and Move Members in the selected Stage channel.
- Member tutorials: the bot and member must both have View Channel for each published step. Members use `/tutorial` without website access.
- Staff DMs: the inbox must be enabled and the member must still belong to the selected server; Discord must allow delivery of the direct message.

The application refreshes access before server actions. A stale open browser tab does not preserve access after the Administrator permission or server membership is removed.

## If an action is unavailable

Confirm the selected server, your current Discord Administrator permission, and the website grants in the table above. For sending failures, also check the bot's permissions in the destination channel. For protected roles, check hierarchy and whether the acting administrator holds that role.

If an event exists but its announcement definitely failed, fix the bot permission and use **Send missing announcement**. If an event or message result is unconfirmed, check Discord before creating another request. Status checks do not resend anything.

## Features still in development

Read message audit and Export message audit are reserved for the separate feature/message-audit branch. Granting them does not start server-chat collection on main. Manage Instagram now opens the setup editor; automatic posting is still unavailable.

See [setup notes](SETUP.md), [security details](../SECURITY.md), and the [project checkpoint](../PROJECT_PLAN.md). The final illustrated Raspberry Pi installation PDF will include the completed release's permission setup.
