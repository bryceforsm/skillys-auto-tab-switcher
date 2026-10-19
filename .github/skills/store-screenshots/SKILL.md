---
name: store-screenshots
description: 'Regenerate the README image and Chrome Web Store screenshots of the popup and rules page. Use when UI, labels or layout change, or when asked to take, refresh or update screenshots, store images or the README picture.'
---

# Store and README Screenshots

Renders the real `popup.html` and `rules.html` with sample data in headless Edge (or Chrome) and writes every image the repo uses. Nothing in `TabSwitcherExtension/` is modified.

## Procedure

1. From the repo root, run [the script](./scripts/Take-Screenshots.ps1):
   ```powershell
   & '.\.github\skills\store-screenshots\scripts\Take-Screenshots.ps1'
   ```
2. View every output and check for cut-off text in dropdowns, wrapped labels or overlapping rows:

   | File | Use |
   |---|---|
| `Screenshots/readme/screenshot.png` | README image (popup with out-of-box settings, light and dark diagonal split, light 1px frame on the dark half, square corners) |
   | `Screenshots/readme/popup-light.png`, `popup-dark.png` | README Screenshots section (popup with a page rule, unframed) |
   | `Screenshots/readme/popup-defaults.png` | Out-of-box popup, unframed, light theme (not used by the README) |
   | `Screenshots/webstore/popup-light.png`, `popup-dark.png` | 1280x800 store screenshots |
| `Screenshots/webstore/popup-defaults.png` | 1280x800, out-of-box settings with no rules and the timer stopped |
   | `Screenshots/webstore/rules-light.png`, `rules-edit-dark.png` | 1280x800 store screenshots |

3. If text is cut off, fix the UI (shorter label or wider control), then run the script again.

## Changing what is shown

- Settings, rules, the current tab URL and the theme come from [assets/mock.js](./assets/mock.js). Edit `store` there.
- Query parameters understood by the mock: `theme=light|dark`, `frame=1` (centre the popup on a 1280x800 backdrop), `defaults=1` (out-of-box `DEFAULTS` from `shared.js`, no rules, timer stopped), `edit=<rule key>` (open the Edit Rule dialog), `measure=1` (magenta backdrop used to measure popup height).
- To add a shot, add a `Save-Shot` line in the script.

## Things that don't work (already tried)

- The VS Code integrated browser only paints the visible part of the page, so it can't produce 1280x800 images.
- `msedge --dump-dom` output isn't captured by PowerShell, so the popup height is measured from a screenshot instead.
- `Start-Process` joins arguments with spaces, so paths with spaces (the repo is under `My Drive`) need embedded quotes. The script renders into a temp folder for that reason.
- Changing only the `#hash` of a `file://` URL doesn't reload the page. Use query parameters.
- Headless capture can land mid CSS transition (for example a green Stop Timer button). The mock turns transitions off, so a wrong color in a shot is a real bug.
