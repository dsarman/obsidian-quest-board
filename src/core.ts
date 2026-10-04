/**
 * Quest Board core: pure functions, no Obsidian / Node dependencies.
 * Input = plain data (frontmatter maps); output = stats + SVG string.
 * Used by both the Obsidian plugin (live view) and render.mjs (server PNG).
 */

export type Frontmatter = Record<string, unknown>;

export interface QuestDef {
  id: string;
  type: "habit" | "project";
  habit?: string;
  project?: string;
  title: string;
  icon?: string;
  color?: string;
  goal?: number;
  weekly?: number;
  anchor?: string;
  why?: string;
  /** Note opened when the card is clicked (link text or vault path). Defaults: project note for projects, today's daily note for habits. */
  note?: string;
}

export interface QuestConfig {
  xp_per_habit?: number;
  xp_per_task?: number;
  xp_per_level?: number;
  quests?: QuestDef[];
}

export interface TaskData extends Frontmatter {
  _projects: string[];
  _path: string;
}

export interface BoardInput {
  config: QuestConfig;
  /** date (YYYY-MM-DD) -> daily note frontmatter */
  daily: Record<string, Frontmatter>;
  tasks: TaskData[];
  today: string; // YYYY-MM-DD
  month?: string; // YYYY-MM, defaults to today's month
}

export interface HabitStats {
  kind: "habit";
  done: number;
  goal: number;
  prevMonth: number;
  last14: boolean[];
  record: number;
  weekStreak: number;
  weekThis: number;
  weekThreshold: number;
}

export interface ProjectStats {
  kind: "project";
  done: number;
  goal: number;
  open: { title: string; path: string }[];
}

export interface QuestStats {
  def: QuestDef;
  stats: HabitStats | ProjectStats;
}

export interface BoardStats {
  month: string;
  today: string;
  xp: number;
  level: number;
  into: number;
  perLevel: number;
  quests: QuestStats[];
}

export const MONTHS_CS = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

// ---------- helpers ----------

export function habitDone(fm: Frontmatter | undefined, key: string): boolean {
  if (!fm) return false;
  const v = fm[key];
  if (Array.isArray(v)) return v.length > 0;
  return v === true;
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function dateOf(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoWeek(d: Date): [number, number] {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return [t.getUTCFullYear(), week];
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function bestStreak(daily: Record<string, Frontmatter>, key: string, upto: string): number {
  let best = 0, cur = 0;
  let prev: Date | null = null;
  for (const dt of Object.keys(daily).sort()) {
    if (dt > upto) break;
    const d = dateOf(dt);
    if (habitDone(daily[dt], key)) {
      cur = prev && (d.getTime() - prev.getTime()) === 86400000 ? cur + 1 : 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
    prev = d;
  }
  return best;
}

export function weekStreak(
  daily: Record<string, Frontmatter>, key: string, threshold: number, today: string,
): { streak: number; thisWeek: number } {
  const counts = new Map<string, number>();
  for (const dt of Object.keys(daily)) {
    if (dt > today) continue;
    if (habitDone(daily[dt], key)) {
      const k = isoWeek(dateOf(dt)).join("-");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const td = dateOf(today);
  const thisKey = isoWeek(td).join("-");
  const thisWeek = counts.get(thisKey) ?? 0;
  // Monday of this ISO week
  let wk = addDays(td, -((td.getUTCDay() || 7) - 1));
  if (thisWeek < threshold) wk = addDays(wk, -7);
  let streak = 0;
  for (;;) {
    const k = isoWeek(wk).join("-");
    if ((counts.get(k) ?? 0) >= threshold) { streak++; wk = addDays(wk, -7); } else break;
  }
  return { streak, thisWeek };
}

// ---------- stats ----------

export function computeStats(input: BoardInput): BoardStats {
  const cfg = input.config;
  const quests = cfg.quests ?? [];
  const xpH = cfg.xp_per_habit ?? 10;
  const xpT = cfg.xp_per_task ?? 20;
  const perLevel = cfg.xp_per_level ?? 100;
  const today = input.today;
  const month = input.month ?? today.slice(0, 7);
  const daily = input.daily;
  const dates = Object.keys(daily).sort();
  const habitKeys = quests.filter(q => q.type === "habit" && q.habit).map(q => q.habit as string);

  let xp = 0;
  for (const dt of dates) for (const k of habitKeys) if (habitDone(daily[dt], k)) xp += xpH;
  for (const t of input.tasks) {
    if (t.recurrence) {
      const inst = t.completeInstances;
      xp += xpH * (Array.isArray(inst) ? inst.length : 0);
    } else if (t.status === "done") {
      xp += xpT;
    }
  }
  const level = Math.floor(xp / perLevel);
  const into = xp % perLevel;

  const out: QuestStats[] = quests.map(def => {
    if (def.type === "habit" && def.habit) {
      const k = def.habit;
      const pm = prevMonth(month);
      const done = dates.filter(d => d.startsWith(month) && habitDone(daily[d], k)).length;
      const prev = dates.filter(d => d.startsWith(pm) && habitDone(daily[d], k)).length;
      const last14 = dates.filter(d => d <= today).slice(-14).map(d => habitDone(daily[d], k));
      const thr = def.weekly ?? 4;
      const ws = weekStreak(daily, k, thr, today);
      const stats: HabitStats = {
        kind: "habit", done, goal: def.goal ?? 20, prevMonth: prev, last14,
        record: bestStreak(daily, k, today), weekStreak: ws.streak, weekThis: ws.thisWeek, weekThreshold: thr,
      };
      return { def, stats };
    }
    const pname = def.project ?? "";
    const pt = input.tasks.filter(t => !t.recurrence && t._projects.includes(pname));
    const open = pt.filter(t => t.status !== "done").map(t => ({ title: String(t.title ?? "?"), path: t._path }));
    const stats: ProjectStats = { kind: "project", done: pt.length - open.length, goal: Math.max(pt.length, 1), open };
    return { def, stats };
  });

  return { month, today, xp, level, into, perLevel, quests: out };
}


// ---------- week ----------

export interface WeekHabit {
  def: QuestDef;
  /** Mon..Sun: true/false, null = day still ahead */
  days: (boolean | null)[];
  done: number;
  threshold: number;
}

export interface WeekProject {
  def: QuestDef;
  doneThisWeek: { title: string; path: string }[];
  done: number;
  goal: number;
}

export interface WeekStats {
  key: string;          // e.g. 2026-W41
  monday: string;       // YYYY-MM-DD
  sunday: string;
  today: string;
  xpWeek: number;
  xp: number;
  level: number;
  perLevel: number;
  habits: WeekHabit[];
  projects: WeekProject[];
}

/** Normalize a frontmatter date (string, Date, or datetime) to YYYY-MM-DD. */
export function dayOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export function isoWeekKey(day: string): string {
  const [y, w] = isoWeek(dateOf(day));
  return `${y}-W${String(w).padStart(2, "0")}`;
}

/** Monday (YYYY-MM-DD) of an ISO week key like 2026-W41. */
export function weekMonday(key: string): string {
  const m = key.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) throw new Error(`bad week key: ${key}`);
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4));
  const mon1 = addDays(jan4, -((jan4.getUTCDay() || 7) - 1));
  return ymd(addDays(mon1, (Number(m[2]) - 1) * 7));
}

/** Week key from a weekly-note path like Notes/2026/10/Weekly/W41.md (folder = Monday's year/month). */
export function weekKeyFromPath(path: string): string | undefined {
  const m = path.match(/(\d{4})\/(\d{2})\/Weekly\/W(\d{1,2})\.md$/);
  if (!m) return undefined;
  let year = Number(m[1]);
  const week = Number(m[3]);
  if (week === 1 && m[2] === "12") year += 1; // W01 whose Monday falls in December
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function computeWeek(input: BoardInput, key?: string): WeekStats {
  const cfg = input.config;
  const quests = cfg.quests ?? [];
  const xpH = cfg.xp_per_habit ?? 10;
  const xpT = cfg.xp_per_task ?? 20;
  const wk = key ?? isoWeekKey(input.today);
  const monday = weekMonday(wk);
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(dateOf(monday), i)));
  const inWeek = (d: string) => d >= days[0] && d <= days[6];
  const total = computeStats(input);

  let xpWeek = 0;
  const habits: WeekHabit[] = [];
  const projects: WeekProject[] = [];
  for (const def of quests) {
    if (def.type === "habit" && def.habit) {
      const k = def.habit;
      const ds = days.map(d => (d > input.today ? null : habitDone(input.daily[d], k)));
      const done = ds.filter(Boolean).length;
      xpWeek += done * xpH;
      habits.push({ def, days: ds, done, threshold: def.weekly ?? 4 });
    } else if (def.project) {
      const pt = input.tasks.filter(t => !t.recurrence && t._projects.includes(def.project as string));
      const doneThisWeek = pt
        .filter(t => t.status === "done" && inWeek(dayOf(t.completedDate)))
        .map(t => ({ title: String(t.title ?? "?"), path: t._path }));
      projects.push({ def, doneThisWeek, done: pt.filter(t => t.status === "done").length, goal: Math.max(pt.length, 1) });
    }
  }
  for (const t of input.tasks) {
    if (t.recurrence) {
      const inst = Array.isArray(t.completeInstances) ? t.completeInstances : [];
      xpWeek += xpH * inst.filter(d => inWeek(dayOf(d))).length;
    } else if (t.status === "done" && inWeek(dayOf(t.completedDate))) {
      xpWeek += xpT;
    }
  }
  return { key: wk, monday: days[0], sunday: days[6], today: input.today, xpWeek, xp: total.xp, level: total.level, perLevel: total.perLevel, habits, projects };
}

// ---------- SVG ----------
// One fluid layout drawn in real pixels for a given width, so text stays the
// same size on a phone and on a desktop (cards just get narrower / taller).

const BG = "#111419", CARD = "#1c202c", TXT = "#ebedf0", MUT = "#8c92a0", SOFT = "#c8ccd4", TRACK = "#2d3240", DIM = "#373c4c", GOLD = "#facc15";
const FONT = "DejaVu Sans, Segoe UI, Helvetica, Arial, sans-serif";
const DAYS_CS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

export type Measure = (text: string, size: number, bold?: boolean) => number;

/** Rough text width when no real font metrics are available (server). Errs wide. */
export const estimateWidth: Measure = (s, size, bold = false) => s.length * size * (bold ? 0.66 : 0.57);

export interface SvgOptions {
  /** Emit data-attributes + class hooks for interactivity (plugin). */
  interactive?: boolean;
  /** Drawing width in px (= container width in Obsidian). */
  width?: number;
  /** Text measurement; the plugin passes canvas metrics of the UI font. */
  measure?: Measure;
  fontFamily?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: string, maxW: number, size: number, m: Measure, bold = false): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || m(cand, size, bold) <= maxW) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.map(l => fit(l, maxW, size, m, bold));
}

function fit(text: string, maxW: number, size: number, m: Measure, bold = false): string {
  if (m(text, size, bold) <= maxW) return text;
  let t = text;
  while (t.length > 1 && m(t + "…", size, bold) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

/** Metrics shared by both views. */
function frame(opts: SvgOptions) {
  const W = Math.max(280, Math.round(opts.width ?? 640));
  const narrow = W < 520;
  return {
    W,
    m: opts.measure ?? estimateWidth,
    M: narrow ? 0 : 4,          // outer margin (Obsidian already pads the note)
    P: narrow ? 14 : 18,        // card padding
    GAP: narrow ? 10 : 12,
    R: narrow ? 17 : 19,        // icon radius
    F: { h: narrow ? 19 : 22, title: narrow ? 16.5 : 17.5, body: 14, small: 12.5 },
    font: opts.fontFamily ?? FONT,
    interactive: !!opts.interactive,
  };
}
type Frame = ReturnType<typeof frame>;
const lh = (s: number) => Math.round(s * 1.4);

function txt(x: number, y: number, s: string, size: number, fill: string, extra = ""): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}"${extra}>${esc(s)}</text>`;
}

function wrapSvg(f: Frame, H: number, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.W} ${H}" width="${f.W}" height="${H}" font-family="${esc(f.font)}" class="qb-svg">`,
    `<rect width="${f.W}" height="${H}" rx="14" fill="${BG}"/>`,
    ...body,
    `</svg>`,
  ].join("\n");
}

/** Icon + title + optional sub line; returns content and the y below the row. */
function cardHead(f: Frame, def: QuestDef, x: number, y: number, rightW: number, sub?: string): { parts: string[]; y: number } {
  const col = def.color ?? "#60a5fa";
  const parts: string[] = [];
  parts.push(`<circle cx="${x + f.R}" cy="${y + f.R}" r="${f.R}" fill="${col}"/>`);
  parts.push(txt(x + f.R, y + f.R, def.icon ?? "•", f.R * 1.05, BG, ` font-weight="bold" text-anchor="middle" dominant-baseline="central"`));
  const tx = x + 2 * f.R + 12;
  const maxW = f.W - f.M - f.P - tx - rightW;
  const titleY = sub ? y + f.R - 3 : y + f.R + f.F.title * 0.35;
  parts.push(txt(tx, titleY, fit(def.title, maxW, f.F.title, f.m, true), f.F.title, TXT, ` font-weight="bold"`));
  if (sub) parts.push(txt(tx, titleY + lh(f.F.small), fit(sub, maxW, f.F.small, f.m), f.F.small, MUT));
  return { parts, y: y + 2 * f.R };
}

/** Pills laid out left-to-right, wrapping; returns content and y below. */
function pills(f: Frame, labels: string[], color: string, x: number, y: number, maxW: number): { parts: string[]; y: number } {
  const parts: string[] = [];
  const h = 22, pad = 10, gap = 6;
  let cx = x, cy = y;
  for (const l0 of labels) {
    const l = fit(l0, maxW - 2 * pad, f.F.small, f.m, true);
    const w = f.m(l, f.F.small, true) + 2 * pad;
    if (cx > x && cx + w > x + maxW) { cx = x; cy += h + gap; }
    parts.push(`<rect x="${cx.toFixed(1)}" y="${cy}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${TRACK}"/>`);
    parts.push(txt(cx + pad, cy + h / 2 + f.F.small * 0.36, l, f.F.small, color, ` font-weight="bold"`));
    cx += w + gap;
  }
  return { parts, y: labels.length ? cy + h : y };
}

function bar(f: Frame, x: number, y: number, w: number, frac: number, color: string, h = 12): string[] {
  const out = [`<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${TRACK}"/>`];
  if (frac > 0) out.push(`<rect x="${x}" y="${y}" width="${Math.max(h, w * Math.min(frac, 1)).toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/>`);
  return out;
}

/** Card background + optional click hook around content that starts at y. */
function card(f: Frame, def: QuestDef, y: number, bottom: number, content: string[]): string[] {
  const hook = f.interactive ? ` data-quest="${esc(def.id)}" class="qb-card"` : "";
  return [`<g${hook}>`, `<rect x="${f.M}" y="${y}" width="${f.W - 2 * f.M}" height="${bottom - y}" rx="14" fill="${CARD}"/>`, ...content, `</g>`];
}

function levelStrip(f: Frame, y: number, level: number, line: string, frac: number): { parts: string[]; y: number } {
  const x = f.M + f.P, iw = f.W - 2 * f.M - 2 * f.P;
  const parts: string[] = [];
  const base = y + f.P + f.F.title * 0.8;
  const lvl = `LVL ${level}`;
  parts.push(txt(x, base, lvl, f.F.title + 1, GOLD, ` font-weight="bold"`));
  const lx = x + f.m(lvl, f.F.title + 1, true) + 12;
  parts.push(txt(lx, base, fit(line, x + iw - lx, f.F.small, f.m), f.F.small, MUT));
  const by = base + 10;
  parts.push(...bar(f, x, by, iw, frac, GOLD, 10));
  const bottom = by + 10 + f.P;
  return { parts: [`<rect x="${f.M}" y="${y}" width="${f.W - 2 * f.M}" height="${bottom - y}" rx="14" fill="${CARD}"/>`, ...parts], y: bottom };
}

export function renderSvg(b: BoardStats, opts: SvgOptions = {}): string {
  const f = frame(opts);
  const { W, M, P, GAP, F, m } = f;
  const [y_, m_] = b.month.split("-").map(Number);
  const body: string[] = [];
  const x0 = M + P, iw = W - 2 * M - 2 * P;
  let y = P;

  y += F.h;
  body.push(txt(M + P, y, fit(`QUEST BOARD · ${MONTHS_CS[m_ - 1]} ${y_}`, W - 2 * (M + P), F.h, m, true), F.h, TXT, ` font-weight="bold"`));
  for (const l of wrap("Každé sezení / hotový úkol ubere bossovi 1 HP. Vynechaný den nic nedělá.", W - 2 * (M + P), F.small, m)) {
    y += lh(F.small);
    body.push(txt(M + P, y, l, F.small, MUT));
  }
  y += 14;
  const ls = levelStrip(f, y, b.level, `${b.xp} XP · ${b.perLevel - b.into} do dalšího levelu`, b.into / b.perLevel);
  body.push(...ls.parts);
  y = ls.y + GAP;

  for (const { def, stats } of b.quests) {
    const col = def.color ?? "#60a5fa";
    const top = y;
    const c: string[] = [];
    const head = cardHead(f, def, x0, y + P, 0, def.anchor ? `kotva: ${def.anchor}` : undefined);
    c.push(...head.parts);
    let cy = head.y + 10;

    const badges: string[] = [];
    if (stats.done >= stats.goal) badges.push("boss poražen");
    if (stats.kind === "habit") badges.push(`rekord ${stats.record} d`, `týdny v řadě ${stats.weekStreak}`, `tento týden ${stats.weekThis}/${stats.weekThreshold}`);
    if (badges.length) { const pr = pills(f, badges, col, x0, cy, iw); c.push(...pr.parts); cy = pr.y + 10; }

    if (def.why) {
      for (const l of wrap(`Proč: ${def.why}`, iw, F.body, m)) { cy += lh(F.body); c.push(txt(x0, cy - 4, l, F.body, SOFT)); }
      cy += 8;
    }

    const count = `${stats.done} / ${stats.goal}`;
    const cw = m(count, F.body, true);
    c.push(...bar(f, x0, cy, iw - cw - 12, stats.done / stats.goal, col, 12));
    c.push(txt(x0 + iw - cw, cy + 11, count, F.body, TXT, ` font-weight="bold"`));
    cy += 12 + 12;

    if (stats.kind === "habit") {
      const prev = `${MONTHS_CS[(m_ - 2 + 12) % 12]}: ${stats.prevMonth}`;
      const pw = m(prev, F.small);
      const step = Math.min(20, (iw - pw - 16) / 14);
      const r = Math.max(3, Math.min(6.5, step * 0.36));
      stats.last14.forEach((ok, i) => c.push(`<circle cx="${(x0 + r + i * step).toFixed(1)}" cy="${cy + 6}" r="${r.toFixed(1)}" fill="${ok ? col : DIM}"/>`));
      c.push(txt(x0 + iw - pw, cy + 10, prev, F.small, MUT));
      cy += 14;
    } else {
      const rest = `zbývá ${stats.open.length}`;
      const rw = m(rest, F.small);
      const nxt = stats.open[0];
      const label = fit(nxt ? `další: ${nxt.title}` : "další: —", iw - rw - 14, F.small, m);
      const link = f.interactive && nxt ? ` class="qb-link" data-path="${esc(nxt.path)}"` : "";
      c.push(txt(x0, cy + 10, label, F.small, MUT, link));
      c.push(txt(x0 + iw - rw, cy + 10, rest, F.small, MUT));
      cy += 14;
    }
    y = cy + P;
    body.push(...card(f, def, top, y, c));
    y += GAP;
  }

  for (const l of wrap(`Vykresleno ${b.today} z denních zápisků a TaskNotes. Nic netrestá, nic neresetuje.`, W - 2 * (M + P), F.small, m)) {
    y += lh(F.small);
    body.push(txt(M + P, y, l, F.small, MUT));
  }
  return wrapSvg(f, y + P, body);
}

function shortDate(d: string): string {
  const [, mo, da] = d.split("-").map(Number);
  return `${da}. ${mo}.`;
}

export function renderWeekSvg(w: WeekStats, opts: SvgOptions = {}): string {
  const f = frame(opts);
  const { W, M, P, GAP, F, m } = f;
  const body: string[] = [];
  const x0 = M + P, iw = W - 2 * M - 2 * P;
  let y = P;

  y += F.h;
  const wn = Number(w.key.split("-W")[1]);
  body.push(txt(x0, y, fit(`TÝDEN ${wn} · ${shortDate(w.monday)} – ${shortDate(w.sunday)}`, iw, F.h, m, true), F.h, TXT, ` font-weight="bold"`));
  for (const l of wrap("Týden se počítá, když habit dosáhne svého prahu. Nic se neodečítá.", iw, F.small, m)) {
    y += lh(F.small);
    body.push(txt(x0, y, l, F.small, MUT));
  }
  y += 14;
  const ls = levelStrip(f, y, w.level, `+${w.xpWeek} XP tento týden · celkem ${w.xp}`, (w.xp % w.perLevel) / w.perLevel);
  body.push(...ls.parts);
  y = ls.y + GAP;

  for (const h of w.habits) {
    const col = h.def.color ?? "#60a5fa";
    const top = y;
    const met = h.done >= h.threshold;
    const right = `${h.done} / ${h.threshold}`;
    const rw = m(right, F.body, true);
    const c: string[] = [];
    const head = cardHead(f, h.def, x0, y + P, rw + 12, met ? "týdenní práh splněn" : h.def.anchor ? `kotva: ${h.def.anchor}` : undefined);
    c.push(...head.parts);
    c.push(txt(x0 + iw - rw, y + P + f.R + F.body * 0.35, right, F.body, met ? col : TXT, ` font-weight="bold"`));
    let cy = head.y + 14;
    const step = Math.min(46, iw / 7);
    const r = Math.min(11, step * 0.32);
    h.days.forEach((d, i) => {
      const cx = x0 + step * i + step / 2;
      if (d === null) c.push(`<circle cx="${cx.toFixed(1)}" cy="${cy + r}" r="${r.toFixed(1)}" fill="none" stroke="${DIM}" stroke-width="2"/>`);
      else c.push(`<circle cx="${cx.toFixed(1)}" cy="${cy + r}" r="${r.toFixed(1)}" fill="${d ? col : DIM}"/>`);
      c.push(txt(cx, cy + 2 * r + lh(F.small) - 2, DAYS_CS[i], F.small, MUT, ` text-anchor="middle"`));
    });
    cy += 2 * r + lh(F.small);
    y = cy + P;
    body.push(...card(f, h.def, top, y, c));
    y += GAP;
  }

  for (const p of w.projects) {
    const col = p.def.color ?? "#60a5fa";
    const top = y;
    const right = `+${p.doneThisWeek.length}`;
    const rw = m(right, F.body, true);
    const c: string[] = [];
    const head = cardHead(f, p.def, x0, y + P, rw + 12, "hotovo tento týden");
    c.push(...head.parts);
    c.push(txt(x0 + iw - rw, y + P + f.R + F.body * 0.35, right, F.body, p.doneThisWeek.length ? col : TXT, ` font-weight="bold"`));
    let cy = head.y + 8;
    for (const t of p.doneThisWeek.slice(0, 5)) {
      cy += lh(F.body);
      const link = f.interactive ? ` class="qb-link" data-path="${esc(t.path)}"` : "";
      c.push(txt(x0, cy - 4, fit(`✓ ${t.title}`, iw, F.body, m), F.body, SOFT, link));
    }
    if (p.doneThisWeek.length > 5) { cy += lh(F.small); c.push(txt(x0, cy - 4, `a dalších ${p.doneThisWeek.length - 5}`, F.small, MUT)); }
    cy += 10;
    const count = `${p.done} / ${p.goal}`;
    const cw = m(count, F.small, true);
    c.push(...bar(f, x0, cy, iw - cw - 12, p.done / p.goal, col, 10));
    c.push(txt(x0 + iw - cw, cy + 9.5, count, F.small, MUT, ` font-weight="bold"`));
    y = cy + 10 + P;
    body.push(...card(f, p.def, top, y, c));
    y += GAP;
  }
  return wrapSvg(f, y - GAP + P, body);
}

// ---------- parsing shared by both hosts ----------

export function normalizeProjects(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return arr.map(x => String(x).replace(/[\[\]"']/g, "").split("|")[0].trim());
}
