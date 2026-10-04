#!/usr/bin/env node
/**
 * Server-side Quest Board renderer: same core as the Obsidian plugin.
 * Reads the vault from disk, writes SVG + PNG, refreshes Quest Board.md.
 *
 * Usage: node render.mjs --vault PATH [--month YYYY-MM] [--out DIR]   (or QB_VAULT=PATH)
 * Prints the PNG path on success.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");
import { Resvg } from "@resvg/resvg-js";
import { computeStats, renderSvg, normalizeProjects } from "./dist/core.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1]]);
  return a;
}, []));
const VAULT = args.vault ?? process.env.QB_VAULT;
if (!VAULT) { console.error("Usage: node render.mjs --vault PATH (or set QB_VAULT)"); process.exit(2); }
const OUT = args.out ?? join(VAULT, "Resources/Attachments/Quest Board");
const NOTE = join(VAULT, "Quest Board.md");

function fm(path) {
  const t = readFileSync(path, "utf8");
  const m = t.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try { return yaml.load(m[1]) ?? {}; } catch { return {}; }
}
function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
function todayPrague() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: process.env.QB_TZ ?? "Europe/Prague" }).format(new Date()); // YYYY-MM-DD
}

const config = fm(join(VAULT, "Config/Quests.md"));
const daily = {};
for (const p of walk(join(VAULT, "Notes"))) {
  const b = basename(p, ".md");
  if (/\/Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) daily[b] = fm(p);
}
const tasks = [];
for (const dir of ["TaskNotes/Tasks", "TaskNotes/Archive"]) {
  for (const p of walk(join(VAULT, dir))) {
    const f = fm(p);
    if (Object.keys(f).length) tasks.push({ ...f, _projects: normalizeProjects(f.projects), _path: p.slice(VAULT.length + 1) });
  }
}
const today = todayPrague();
const stats = computeStats({ config, daily, tasks, today, month: args.month });
const svg = renderSvg(stats, { interactive: false });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "questboard.svg"), svg);
const png = new Resvg(svg, {
  font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
  fitTo: { mode: "width", value: 1200 },
}).render().asPng();
const pngPath = join(OUT, "questboard.png");
writeFileSync(pngPath, png);
copyFileSync(pngPath, join(OUT, `questboard-${stats.month}.png`));

writeFileSync(NOTE, `---
tags: [dashboard]
updated: ${today}
---

# Quest Board

\`\`\`quests
\`\`\`

- Definice questů, cílů a „Proč“: [[Quests]]
- Level ${stats.level} · ${stats.xp} XP (stav k ${today}). Blok nahoře je živý (plugin Quest Board); níže je noční snímek pro Telegram a pro zařízení bez pluginu.
- Historie: \`Resources/Attachments/Quest Board/questboard-YYYY-MM.png\`

![[Resources/Attachments/Quest Board/questboard.png]]
`);
console.log(pngPath);
