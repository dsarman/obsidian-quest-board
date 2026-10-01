# Quest Board (Obsidian plugin + server renderer)

Habitica-style board over existing vault data. **One core (`src/core.ts`)** computes stats and emits SVG; two hosts use it:

- **Obsidian plugin** (`src/main.ts` → `main.js`): a ```` ```quests ```` code block renders the live SVG from `metadataCache`, refreshes on vault changes, cards are clickable (project note / next task / `Config/Quests.md`). Optional `month: YYYY-MM` inside the block.
- **Server** (`render.mjs`): reads the vault from disk, writes `questboard.svg` + `questboard.png` (via `@resvg/resvg-js`, no browser) and refreshes `Quest Board.md`. Run by Hermes cron nightly; the PNG goes to Telegram on Sunday.

## Build / install
```
npm install && npm run build          # -> main.js, dist/core.js
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/quest-board/
node render.mjs [--vault PATH] [--month YYYY-MM]
```
Enable "Quest Board" in Obsidian → Community plugins (restricted mode off). Config lives in the vault: `Config/Quests.md` frontmatter.
