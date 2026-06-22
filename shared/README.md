# Shared icons

Theme-resilient SVG icons, shared across every Paths and Proofs site
(the calculators, RothGuide, the landing page, the vault). Each uses
`stroke="currentColor"`, so it inherits the surrounding text color and needs no
separate light/dark version — set the color in your theme and the icon follows.

**Theme toggle**
- `sun.svg` — shown in light mode on the theme toggle
- `moon.svg` — shown in dark mode on the theme toggle

**Actions**
- `print.svg` — "Print / Save as PDF"
- `download.svg` — "Download encrypted backup" (arrow down into tray)
- `restore.svg` — "Restore from a backup file" (arrow up from tray)
- `lock-closed.svg` — "Lock" (vault locked / data protected)
- `lock-open.svg` — "Unlock" (vault open)
- `erase.svg` — "Erase everything" (destructive — see note below)
- `info.svg` — help / tooltip trigger (replaces the typographic ⓘ)

The sun and moon are lifted verbatim from RothGuide so the family stays
consistent. The rest are drawn to match their line style (24×24, 2px stroke,
rounded).

## Which icon goes with which vault button

These map directly to the existing buttons in `in-case-im-not-there`:

| Button id    | Label                      | Icon            |
|--------------|----------------------------|-----------------|
| `lockNow`    | Lock                       | lock-closed.svg |
| (lock screen)| Unlock                     | lock-open.svg   |
| `printBtn`   | Print / Save as PDF        | print.svg       |
| `exportBtn`  | Download encrypted backup  | download.svg    |
| `importBtn`  | Restore from a backup file | restore.svg     |
| `eraseBtn`   | Erase everything           | erase.svg       |

## Theme toggle: use BOTH icons, show one per theme

The toggle needs both the sun and moon present in the page at once; CSS reveals
the right one for the current theme. Paste both inline inside the button:

```html
<button class="theme-btn" onclick="toggleTheme()" id="themeBtn"
        aria-label="Switch to dark mode" title="Switch to dark mode">
  <svg class="ic-sun" ...></svg>   <!-- contents of sun.svg -->
  <svg class="ic-moon" ...></svg>  <!-- contents of moon.svg -->
</button>
```

```css
.theme-btn .ic-moon { display: none; }                      /* light: show sun */
[data-theme="dark"] .theme-btn .ic-sun  { display: none; }  /* dark: show moon */
[data-theme="dark"] .theme-btn .ic-moon { display: block; }
```

Inlining (rather than `<img src>`) is required here because `currentColor` and
the show/hide CSS only work when the SVG is part of the page's DOM.

## Lock pair: confirm it reads at small sizes

`lock-closed` and `lock-open` differ by the shackle position (open lifts on the
right). That distinction is clear at icon size but can be subtle on very small
buttons (~17px). If the vault uses small buttons, keep the text label alongside
the icon, or confirm the open/closed state reads on the live page.

## Erase: destructive

`erase.svg` labels a permanent, irreversible action. Keep it visually distinct
(the vault already styles its erase button with a danger color) and keep the
confirmation step — the icon should never make erasing feel one-tap-easy.

## Note on scope

This folder holds icons only — deliberately. Colors, fonts, and full
stylesheets are NOT shared here, because the sites don't yet share a palette
(the calculators use teal; RothGuide uses navy/amber). Icons are safe to share
precisely because they're colorless and inherit. If the palettes are unified
later, that's when other shared styling would join this folder.
