# Foundation design system

Source: `foundation-concept.png` (1505 × 1045), inspected before implementation. The image is the visual reference; the website consists of native HTML, CSS, and React controls.

## Locked visual direction

- White content and header; a cool gray sidebar. Navy headings and icons, blue-gray secondary text, restrained indigo navigation and actions. No gradients, media overlays, decorative cards, fabricated metrics, or activity.
- Desktop: 290px left rail at the reference width, 80px header, 32px content gutters, 44px opening gap. One outlined sign-in panel, followed by open feature rows and a short numbered list. Footer begins after content or rests at the bottom of taller windows.
- Typography: system sans-serif stack; 40px/1.2 bold primary heading, 28px section heading, 23px panel title, 20px row title, 18px body, 16px utility and navigation. Scale primary heading down on narrow screens.
- Tokens: background `#ffffff`, rail `#f3f6fb`, ink `#0b123b`, secondary `#5d6d87`, border `#d7deea`, indigo `#253db5`, selected rail `#e4e9ff`. 8px panel corners, 5px button corners, minimal elevation. Spacing follows 4/8/12/16/24/32/40/48px steps.
- Icons: lucide outline, 1.8–2px strokes, navy/secondary ink, 22px navigation, 32px feature rows, 70px shield; Discord glyph on the sign-in action. Icons are decorative when adjacent labels convey their meaning.

## Allowed reference copy

Discord Bot; Workspace; Overview; Permissions; Setup guide; Your community starts here.; Connect Discord to manage your servers in one place.; Connect your Discord application; Add your application credentials to enable secure sign-in.; Continue with Discord; Waiting for configuration.; Built around your server; Discord sign-in; Access requires Discord login and Administrator permission.; Server owner access; Owners always retain control of their server.; Separate workspaces; Each server has its own activity, settings, and permissions.; Next steps; Create a Discord application; Add the configuration values; Sign in and choose a server; Your servers, clearly separated.; Accessibility statement; Privacy & retention.

## Components and functional extensions

App shell owns desktop rail, responsive top navigation, utility header, server selector, footer, and skip link. Landing owns the exact missing-configuration composition. Shared status regions cover loading, errors, and retry. Guild overview uses an accessible activity list and a real empty state. Permissions uses a labeled role selector, checkbox fieldset, and explicit save; editability is limited by the live access response and enforced again by the server. All future-feature permission labels are marked as configuration for later stages. No future feature action buttons are shown.

Policy and setup pages extend the same open content typography, dividers, and links. The first-login walkthrough uses a native modal dialog with labeled controls, persisted step progress, Skip, Back, Continue, Finish, and reset. No welcome overlay appears before authentication.

On mobile, the rail becomes a compact brand/navigation region above the header. Content and controls reflow without horizontal scrolling; tables are represented as readable stacked records. Focus is a visible indigo outline, every input is labeled, status updates use live regions, and reduced-motion preferences suppress optional motion. No custom web fonts, remote scripts, analytics, or image dependencies are required.

## Verification ledger

The implementation should be compared at 1505 × 1045 and at a narrow mobile viewport. Verify: exact missing-configuration copy; sidebar/header/content positions; navy/gray/indigo palette; heading/control typography; outlined panel and open feature-row container model; matching icon meanings; footer and mobile reflow. Intentional extensions: authenticated content, policies, setup instructions, accessible focus, status/errors, and walkthrough, required by the product brief.

### Stage 1 inspection result

Compared the saved concept and browser screenshot with `view_image`. In-app browser used at the concept size 1505×1045; phone reflow checked at 390×844, document width exactly 390px and one H1. Compared exact setup copy, left rail/header/main composition, heading hierarchy and control typography, white/cool-gray/navy/indigo palette, single outlined connection panel and open feature rows, outline icon meanings, footer links, and mobile collapse. No added above-the-fold copy in the setup state. The implementation faithfully follows the reference structure and design system; minor system-font rasterization differences remain. No material layout mismatch identified. The browser confirmed the accessibility page opens and Permissions remains locked without credentials. Authenticated rendering still requires live Discord credentials or an isolated UI test harness; no auth bypass was added. Screenshots are retained as project design/checkpoint evidence.

### Stage 2 extension verification

The composer uses the same white/cool-gray/navy/indigo palette, sidebar/header proportions, typography, outlined controls, accessible focus and footer as the foundation reference. Its review and delivery panels are functional extensions required by the user. In-app browser verified simulated sign-in, tutorial skip/reset, selection, draft review and successful simulated delivery. Phone width390px had no overflow. The saved composer screenshot was inspected with view_image; no material layout defect was identified. No real external message was sent.

### Stage 3a extension verification

The staff inbox extends the established palette, typography, sidebar/header, outlined controls and footer. The conversation list and message detail use two columns on desktop and one column on a phone. Local Chromium tested simulated sign-in, disabled/enabled intake, read/review/send, escaped content, one reply, close/filter/history and footer navigation. The 390px viewport had no horizontal overflow or browser errors. Desktop and mobile renders were inspected with view_image; all content is simulated. No real Discord message was sent. Native focus and labeled controls are retained; full assistive-technology validation remains in the release stage.

### Stage 4a events verification

Events extend the same established shell, palette, type and controls. Browser plugin absent: regular Playwright/Chromium against an isolated fake Discord preview at 127.0.0.1:3001. Desktop1505x1045 and mobile390x844, external and voice creation, graphic/alt preview, timezone review, failed-announcement recovery and read-only status checked. Initial signed-out /api/me 401 is expected; no other app console or runtime errors allowed. Screenshots inspected with view_image; no material layout defect or mobile overflow. Screenshot input graphic is itself a simulated dashboard screenshot, used solely to verify file selection and preview. No live Discord messages or events created.
