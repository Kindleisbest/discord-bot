# Easter egg plan: Pi Party
Status: planned only. Requested by Andrew on 11 September 2026.

A small Raspberry Pi mascot briefly takes over the dashboard with the message: **“Tiny computer. Big admin energy.”**

## Finding it

While viewing a server they own, the owner activates the Discord Bot logo five times within eight seconds. The logo uses a real button so mouse clicks, touch, Enter, and Space all work. A subtle hint appears after the third activation. Its accessible description explains the repeated-activation shortcut.

The trigger is available only in the selected server owner's workspace. It uses the existing owner-access result; it introduces no new account, permission, or login path.

## The surprise

- A small pixel-style Pi mascot rolls onto the page.
- A brief burst of berry-colored confetti appears inside the website.
- The mascot displays “Tiny computer. Big admin energy.”
- A second line is chosen locally from:
  - “Powered by snacks and questionable cable management.”
  - “Your servers are in very small hands.”
  - “One Pi to moderate them all.”
- Two buttons: **One more beep** changes the joke; **Back to business** closes the surprise. There is no actual sound.

Everything happens in the browser. The egg sends no Discord messages, reads no chats, awards no levels, and changes no server settings.

## Accessibility and performance

Use a labeled native dialog, move focus inside it, support Escape, and return focus to the logo when closed. Keep focus visible and announce the first joke once. No flashing or autoplay audio. With reduced motion enabled, show the static mascot and text with no confetti.

Use small inline SVG/CSS artwork following the existing dashboard palette. Keep the animation under three seconds, pause it when the page is hidden, and remove particles and timers when it ends. Limit opening to once per minute. No external images, downloads, services, or recurring background work.

## Implementation and checks

Implement as a small optional frontend component on main after the member tutorial milestone. Do not connect it to the separate chat-audit branch.

Verify owner-only discovery, counter timeout/reset, keyboard and touch activation, dialog focus/Escape behavior, reduced motion, phone layout, timer cleanup, and that opening the egg makes no network requests or changes to saved data.

This document is the plan only. No Easter egg code or artwork has been added yet.
