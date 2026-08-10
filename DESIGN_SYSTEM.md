# Department Vote Design System

## Source of truth

- Selected direction: Option 3, chosen by the user.
- Reference: `design/references/registration-option-3.png`.
- Target content viewport: 390 x 844 CSS pixels; the prototype runtime uses its protected 393 x 852 device screen.
- Product quality: calm, optimistic, trustworthy, and suitable for an official department election.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--color-canvas` | `#fbf7ed` | Main warm-sand background |
| `--color-ink` | `#073f2b` | Headings and primary content |
| `--color-body` | `#242722` | Body copy |
| `--color-success` | `#2f8750` | Completed state |
| `--color-current` | `#ff6f61` | Current/next state |
| `--color-muted` | `#777a74` | Waiting state text |
| `--color-muted-surface` | `#ebe2cd` | Waiting step marker |
| `--color-info` | `#075dab` | Explanatory action |
| `--color-privacy-surface` | `#e8efd6` | Privacy reassurance icon surface |
| `--color-divider` | `#dfd5bd` | Section divider |
| `--color-on-primary` | `#ffffff` | Text and icons on primary action |

Color never communicates status alone; every state also has text and a distinct icon or marker.

## Typography

- Display and interface family: `Roboto`, with system sans-serif fallbacks.
- Overline: 13 px, 700 weight, uppercase, 0.16 em tracking.
- Main heading: 42 px mobile, 700 weight, 0.98 line-height, tight tracking.
- Step heading: 20 px, 700 weight, 1.2 line-height.
- Body: 17 px, 400 weight, 1.45 line-height.
- Status: 17 px, 500 weight.
- Primary action: 20 px, 700 weight.

Text must remain usable at 200% zoom and with browser font enlargement.

## Layout and spacing

- Four-pixel base unit with primary spacing values of 8, 12, 16, 24, 32, and 40 px.
- Content gutters: 28 px on the selected mobile canvas.
- Sections follow the selected vertical journey: heading, three-step progress, privacy reassurance, primary action, explanation link, Belenios boundary.
- Corners are restrained: 12 px for the privacy icon surface and 14 px for the primary action.
- Do not add nested cards, gradients, glass effects, or decorative photography.

## Interaction and accessibility

- Minimum touch target: 44 x 44 px; prefer 48 px for the main action.
- Native semantic buttons and links are required.
- Focus styles must be visible with at least a 2 px outline and sufficient contrast.
- Errors state the cause and a recovery action and are connected to their input.
- Loading and submission states use live-region text without moving focus unexpectedly.
- Nonessential motion respects `prefers-reduced-motion`.
- The DoJah widget callback indicates completion only; it never grants eligibility.
