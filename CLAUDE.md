# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Scoundrel is a solo dungeon-crawling card game built with **vanilla HTML/CSS/JS, zero dependencies, no build step**. Open `index.html` in a browser to run it. The live site is hosted on GitHub Pages at https://diegoborgh.github.io/scoundrel-game/.

There is no package manager, no bundler, no test suite, and no lint config. "Building" means reloading the page.

## Architecture

The entire game lives in three files at the repo root:

- [index.html](index.html) — Three stacked full-screen panels (`#start-screen`, `#game-screen`, `#gameover-overlay`) plus a `#rules-modal`. JS toggles `.active` on screens rather than routing.
- [styles.css](styles.css) — All styling, responsive breakpoints, and animations. Dark fantasy theme using `Cinzel Decorative` from Google Fonts.
- [game.js](game.js) — A single ~1500-line script organized into commented sections (search for `// ===` banners):
  1. Constants & asset mapping
  2. Game state (single `state` object — the source of truth)
  3. Deck construction & shuffle (44 cards: clubs/spades 2–14, diamonds/hearts 2–10)
  4. Game logic (`drawRoom`, `resolveCard`, `resolveMonster`, `resolveWeapon`, `resolvePotion`, `avoidRoom`)
  5. Rendering (`renderAll` rebuilds DOM from `state`; called after every state change)
  6. Audio — **procedural** Web Audio API synthesis; there are no audio files. Includes title music, victory fanfare, defeat march, and per-action sfx.
  7. Event handling (mouse, keyboard 1–4 + `A`, touch)
  8. `init()` wires it all up on load

Key mental model: mutate `state`, then call `renderAll()`. Rendering is not incremental.

### Card art

Card images in [assets/](assets/) are grouped by suit and value range (e.g. `club-1.png` = low clubs, `club-3.png` = high clubs). The mapping lives in `getCardAsset()` in [game.js](game.js) — update it there if you add or rename assets.

### Dev console helpers

After clicking "Enter the Dungeon", these are exposed on `window` for manual testing:

- `devWin()` — trigger the victory screen
- `devLose()` — trigger the defeat screen

## Game rules (load-bearing for logic changes)

- Monsters (♣♠): damage = face value, J/Q/K/A = 11/12/13/14.
- Weapons (♦ 2–10): equipping replaces the current weapon. A weapon can only fight monsters with value ≤ the last monster it defeated (unlimited until first use). Tracked as `state.weapon.lastDefeated`.
- Potions (♥ 2–10): heal up to `MAX_HP = 20`. Only the first potion in a room heals; subsequent potions in the same room are wasted (`state.potionUsedThisRoom`).
- Each room draws 4 cards; the player resolves 3, and the 4th carries over. **Avoid** sends all 4 to the bottom of the deck but cannot be used twice in a row or after a card has been resolved this room (`state.lastAvoided`, `state.resolvedThisRoom`).
