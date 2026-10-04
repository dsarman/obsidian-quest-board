#!/usr/bin/env node
/**
 * Server-side Quest Board renderer: same core as the Obsidian plugin.
 * Reads the vault read-only and writes questboard.svg + questboard.png to --out (default: current dir).
 * Never writes into the vault.
 *
 * Usage: node render.mjs --vault PATH [--view month|week] [--month YYYY-MM] [--week YYYY-Www]
 *                        [--width PX] [--out DIR] [--now HH:MM|auto]   (or QB_VAULT=PATH)
 * The Now card is off unless --now is given.
 * Prints the PNG path on success.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");
import { Resvg } from "@resvg/resvg-js";
import { computeStats, computeWeek, renderSvg, renderWeekSvg, normalizeProjects, referencedNotes } from "./dist/core.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith("--")) a.push([x.slice(2), arr[i + 1]]);
  return a;
}, []));
const VAULT = args.vault ?? process.env.QB_VAULT;
if (!VAULT) { console.error("Usage: node render.mjs --vault PATH (or set QB_VAULT)"); process.exit(2); }
const OUT = args.out ?? process.cwd();

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
const bodies = {};
for (const p of walk(join(VAULT, "Notes"))) {
  const b = basename(p, ".md");
  if (/\/Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) { daily[b] = fm(p); bodies[b] = readFileSync(p, "utf8"); }
}
const texts = {};
for (const n of referencedNotes(config)) {
  try { texts[n] = readFileSync(join(VAULT, n.endsWith(".md") ? n : `${n}.md`), "utf8"); } catch { /* missing note: no instruction */ }
}
const tasks = [];
for (const dir of ["TaskNotes/Tasks", "TaskNotes/Archive"]) {
  for (const p of walk(join(VAULT, dir))) {
    const f = fm(p);
    if (Object.keys(f).length) tasks.push({ ...f, _projects: normalizeProjects(f.projects), _path: p.slice(VAULT.length + 1) });
  }
}
const today = todayPrague();
const width = Number(args.width ?? 640);
const nowArg = args.now === "auto"
  ? new Intl.DateTimeFormat("en-GB", { timeZone: process.env.QB_TZ ?? "Europe/Prague", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())
  : args.now;
const input = { config, daily, tasks, today, month: args.month, bodies, texts, now: nowArg };
const svg = args.view === "week"
  ? renderWeekSvg(computeWeek(input, args.week), { width })
  : renderSvg(computeStats(input), { width });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "questboard.svg"), svg);
const png = new Resvg(svg, {
  font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
  fitTo: { mode: "zoom", value: 2 }, // crisp on phones
}).render().asPng();
const pngPath = join(OUT, "questboard.png");
writeFileSync(pngPath, png);
console.log(pngPath);
