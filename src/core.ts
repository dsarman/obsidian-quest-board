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
  /** Words that identify this quest in plan lines and reflections (case-insensitive substrings). Default: title + habit key. */
  words?: string[];
  /** Time window "HH:MM-HH:MM" for the Now card when today's plan has no timed line for it. */
  when?: string;
  /** ISO weekdays (1 = Mon … 7 = Sun) on which `when` applies. Default: every day. */
  days?: number[];
  /** Short instruction shown on the Now card. */
  how?: string;
  /** Take the instruction from a note: the last list item labelled `label` (e.g. "Příště") and its sub-items. */
  how_from?: { note: string; label?: string };
}

export interface QuestConfig {
  xp_per_habit?: number;
  xp_per_task?: number;
  xp_per_level?: number;
  /** Bonus XP when a habit is done again after a pause. */
  xp_per_comeback?: number;
  /** Days without the habit that make the next one a comeback (default 3). */
  comeback_gap?: number;
  /** Now card: heading of the timed plan in daily notes (Day Planner format). */
  plan_heading?: string;
  /** Reflection headings (substring match) mined for quotes; empty/absent = quotes off. */
  quote_headings?: string[];
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
  /** Current local time "HH:MM" (enables the Now card). */
  now?: string;
  /** date -> full daily-note markdown (for plan + reflection quotes). */
  bodies?: Record<string, string>;
  /** vault path -> markdown of notes referenced by `how_from`. */
  texts?: Record<string, string>;
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
  comebacks: number;
  /** "today" | "yesterday" when the latest session was a comeback. */
  comebackRecent: "today" | "yesterday" | null;
  quote?: Quote;
}

export interface Quote { date: string; text: string }

export interface NowItem {
  state: "now" | "next";
  start: string;
  end?: string;
  label: string;
  quest?: QuestDef;
  how: string[];
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
  now?: NowItem;
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


// ---------- comebacks ----------

/** Dates on which a habit was done after at least `gap` days without it. */
export function comebackDays(daily: Record<string, Frontmatter>, key: string, upto: string, gap: number): string[] {
  const out: string[] = [];
  let prev: Date | null = null;
  for (const dt of Object.keys(daily).sort()) {
    if (dt > upto) break;
    if (!habitDone(daily[dt], key)) continue;
    const d = dateOf(dt);
    if (prev && Math.round((d.getTime() - prev.getTime()) / 86400000) - 1 >= gap) out.push(dt);
    prev = d;
  }
  return out;
}

// ---------- text helpers ----------

export function cleanMd(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => String(t).split("/").pop() as string)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questWords(def: QuestDef): string[] {
  const w = def.words?.length ? def.words : [def.title, def.habit ?? "", def.project ?? ""];
  return w.map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 3);
}

function matchesQuest(text: string, def: QuestDef): boolean {
  const t = text.toLowerCase();
  return questWords(def).some(w => t.includes(w));
}

function stripFrontmatter(md: string): string {
  return md.startsWith("---") ? md.replace(/^---\n[\s\S]*?\n---\n?/, "") : md;
}

/** Bullet lines under headings whose text contains one of `headings`. */
export function sectionLines(md: string, headings: string[]): string[] {
  const hs = headings.map(h => h.toLowerCase());
  const out: string[] = [];
  let on = false;
  for (const raw of stripFrontmatter(md).split("\n")) {
    const h = raw.match(/^#{1,6}\s+(.*)$/);
    if (h) { const t = h[1].toLowerCase(); on = hs.some(x => t.includes(x)); continue; }
    if (!on) continue;
    const l = cleanMd(raw.replace(/^\s*[-*+]\s+(\[.\]\s+)?/, ""));
    if (l && l !== "-") out.push(l);
  }
  return out;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A sentence from the user's own reflections that mentions the quest; rotates daily. */
export function pickQuote(def: QuestDef, bodies: Record<string, string>, headings: string[], today: string): Quote | undefined {
  const found: Quote[] = [];
  for (const d of Object.keys(bodies).sort()) {
    if (d > today) continue;
    for (const l of sectionLines(bodies[d], headings)) if (matchesQuest(l, def)) found.push({ date: d, text: l });
  }
  if (!found.length) return undefined;
  return found[hashStr(today + def.id) % found.length];
}

// ---------- Now card ----------

export interface PlanItem { done: boolean; start: string; end?: string; text: string; links: string[] }

function hhmm(s: string): string { const [h, m] = s.split(":"); return `${h.padStart(2, "0")}:${m}`; }
function addMin(t: string, n: number): string {
  const [h, m] = t.split(":").map(Number);
  const v = Math.min(h * 60 + m + n, 24 * 60 - 1);
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Timed lines (Day Planner format) under `heading`. */
export function parsePlan(md: string, heading: string): PlanItem[] {
  const lines = stripFrontmatter(md).split("\n");
  const items: PlanItem[] = [];
  let level = 0;
  for (const raw of lines) {
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && h[2].trim().toLowerCase().includes(heading.toLowerCase())) level = h[1].length;
      continue;
    }
    if (!level) continue;
    const m = raw.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s+(.*)$/);
    if (!m) continue;
    const links = Array.from(m[4].matchAll(/\[\[([^\]|#]+)/g)).map(x => x[1].split("/").pop() as string);
    items.push({ done: (m[1] ?? " ").trim() !== "", start: hhmm(m[2]), end: m[3] ? hhmm(m[3]) : undefined, text: m[4], links });
  }
  return items;
}

/** Last list item labelled `label` in md, plus its nested sub-items. */
export function extractHow(md: string, label: string): string[] {
  const lines = stripFrontmatter(md).split("\n");
  let idx = -1;
  const lab = label.toLowerCase();
  lines.forEach((l, i) => {
    const t = l.replace(/\*\*/g, "").replace(/^\s*[-*+]\s+/, "").trim().toLowerCase();
    if (/^\s*[-*+]\s+/.test(l) && t.startsWith(lab)) idx = i;
  });
  if (idx < 0) return [];
  const base = (lines[idx].match(/^\s*/) as RegExpMatchArray)[0].length;
  const out: string[] = [];
  const inline = cleanMd(lines[idx].replace(/^\s*[-*+]\s+/, "").replace(/\*\*/g, "").slice(label.length).replace(/^\s*:\s*/, ""));
  if (inline) out.push(inline);
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) break;
    const ind = (l.match(/^\s*/) as RegExpMatchArray)[0].length;
    if (ind <= base) break;
    const t = cleanMd(l.replace(/^\s*[-*+]\s+/, ""));
    if (t) out.push(t);
  }
  return out;
}

function taskDoneToday(tasks: TaskData[], name: string, today: string): boolean | undefined {
  const t = tasks.find(x => (x._path.split("/").pop() ?? "").replace(/\.md$/, "") === name);
  if (!t) return undefined;
  if (t.recurrence) {
    const inst = Array.isArray(t.completeInstances) ? t.completeInstances : [];
    return inst.some(d => dayOf(d) === today);
  }
  return t.status === "done";
}

function weekday(day: string): number { return dateOf(day).getUTCDay() || 7; }

function howFor(def: QuestDef | undefined, texts: Record<string, string>): string[] {
  if (!def) return [];
  const out: string[] = [];
  if (def.how_from) {
    const key = Object.keys(texts).find(k => k === def.how_from!.note || k === `${def.how_from!.note}.md`);
    if (key) out.push(...extractHow(texts[key], def.how_from.label ?? "Příště"));
  }
  if (def.how) out.push(def.how);
  return out;
}

export function computeNow(input: BoardInput): NowItem | undefined {
  const now = input.now;
  if (!now) return undefined;
  const cfg = input.config;
  const quests = cfg.quests ?? [];
  const today = input.today;
  const fm = input.daily[today];
  const texts = input.texts ?? {};
  const doneQuest = (q?: QuestDef) => !!q && q.type === "habit" && !!q.habit && habitDone(fm, q.habit);

  type Cand = { start: string; end: string; label: string; quest?: QuestDef };
  const cands: Cand[] = [];
  const body = input.bodies?.[today];
  if (body) {
    for (const it of parsePlan(body, cfg.plan_heading ?? "Day planner")) {
      if (it.done) continue;
      if (it.links.some(l => taskDoneToday(input.tasks, l, today) === true)) continue;
      const quest = quests.find(q => matchesQuest(it.text, q) || it.links.some(l => matchesQuest(l, q)));
      if (doneQuest(quest)) continue;
      cands.push({ start: it.start, end: it.end ?? addMin(it.start, 30), label: cleanMd(it.text), quest });
    }
  }
  // quests with a `when` window that today's plan doesn't already schedule
  for (const q of quests) {
    const w = q.when?.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!w || doneQuest(q)) continue;
    if (q.days?.length && !q.days.includes(weekday(today))) continue;
    if (cands.some(c => c.quest?.id === q.id)) continue;
    cands.push({ start: hhmm(w[1]), end: hhmm(w[2]), label: q.title, quest: q });
  }
  cands.sort((a, b) => a.start.localeCompare(b.start));
  const cur = cands.find(c => c.start <= now && now < c.end);
  const pick = cur ?? cands.find(c => c.start > now);
  if (!pick) return undefined;
  return {
    state: cur ? "now" : "next", start: pick.start, end: pick.end, label: pick.label,
    quest: pick.quest, how: howFor(pick.quest, texts),
  };
}

/** Notes the board reads besides daily notes and tasks (for hosts that load text). */
export function referencedNotes(cfg: QuestConfig): string[] {
  return (cfg.quests ?? []).map(q => q.how_from?.note).filter((x): x is string => !!x);
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
  const xpC = cfg.xp_per_comeback ?? 10;
  const gap = cfg.comeback_gap ?? 3;
  for (const k of habitKeys) xp += xpC * comebackDays(daily, k, today, gap).length;
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
      const cbs = comebackDays(daily, k, today, gap);
      const lastDone = [...dates].reverse().find(d => d <= today && habitDone(daily[d], k));
      const yesterday = ymd(addDays(dateOf(today), -1));
      const lastCb = cbs[cbs.length - 1];
      const comebackRecent = lastCb && lastCb === lastDone ? (lastCb === today ? "today" : lastCb === yesterday ? "yesterday" : null) : null;
      const quote = cfg.quote_headings?.length && input.bodies ? pickQuote(def, input.bodies, cfg.quote_headings, today) : undefined;
      const stats: HabitStats = {
        kind: "habit", done, goal: def.goal ?? 20, prevMonth: prev, last14,
        record: bestStreak(daily, k, today), weekStreak: ws.streak, weekThis: ws.thisWeek, weekThreshold: thr,
        comebacks: cbs.length, comebackRecent, quote,
      };
      return { def, stats };
    }
    const pname = def.project ?? "";
    const pt = input.tasks.filter(t => !t.recurrence && t._projects.includes(pname));
    const open = pt.filter(t => t.status !== "done").map(t => ({ title: String(t.title ?? "?"), path: t._path }));
    const stats: ProjectStats = { kind: "project", done: pt.length - open.length, goal: Math.max(pt.length, 1), open };
    return { def, stats };
  });

  return { month, today, xp, level, into, perLevel, quests: out, now: computeNow(input) };
}


// ---------- week ----------

export interface WeekHabit {
  def: QuestDef;
  /** Mon..Sun: true/false, null = day still ahead */
  days: (boolean | null)[];
  done: number;
  threshold: number;
  comeback: boolean;
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
      const cbs = comebackDays(input.daily, k, input.today, cfg.comeback_gap ?? 3).filter(inWeek);
      xpWeek += done * xpH + cbs.length * (cfg.xp_per_comeback ?? 10);
      habits.push({ def, days: ds, done, threshold: def.weekly ?? 4, comeback: cbs.length > 0 });
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

function nowCard(f: Frame, n: NowItem, y: number): { parts: string[]; y: number } {
  const { P, F, m, W, M } = f;
  const x0 = M + P, iw = W - 2 * M - 2 * P;
  const col = n.quest?.color ?? GOLD;
  const c: string[] = [];
  let cy = y + P + F.small;
  const head = n.state === "now" ? `TEĎ · ${n.start}${n.end ? `–${n.end}` : ""}` : `DALŠÍ · ${n.start}`;
  c.push(txt(x0, cy, head, F.small, col, ` font-weight="bold" letter-spacing="0.5"`));
  for (const l of wrap(n.label, iw, F.title, m, true).slice(0, 2)) { cy += lh(F.title); c.push(txt(x0, cy, l, F.title, TXT, ` font-weight="bold"`)); }
  for (const h of n.how.slice(0, 6)) {
    for (const [i, l] of wrap(h, iw - 14, F.body, m).slice(0, 2).entries()) {
      cy += lh(F.body);
      if (i === 0) c.push(`<circle cx="${x0 + 4}" cy="${(cy - F.body * 0.35).toFixed(1)}" r="2.5" fill="${col}"/>`);
      c.push(txt(x0 + 14, cy, l, F.body, SOFT));
    }
  }
  const bottom = cy + P;
  const hook = f.interactive ? ` class="qb-now"${n.quest ? ` data-quest="${esc(n.quest.id)}"` : ""}` : "";
  return {
    parts: [`<g${hook}>`, `<rect x="${M + 1}" y="${y + 1}" width="${W - 2 * M - 2}" height="${bottom - y - 2}" rx="14" fill="${CARD}" stroke="${col}" stroke-width="2"/>`, ...c, `</g>`],
    y: bottom,
  };
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
  if (b.now) { const nc = nowCard(f, b.now, y); body.push(...nc.parts); y = nc.y + GAP; }

  for (const { def, stats } of b.quests) {
    const col = def.color ?? "#60a5fa";
    const top = y;
    const c: string[] = [];
    const head = cardHead(f, def, x0, y + P, 0, def.anchor ? `kotva: ${def.anchor}` : undefined);
    c.push(...head.parts);
    let cy = head.y + 10;

    const badges: string[] = [];
    if (stats.done >= stats.goal) badges.push("boss poražen");
    if (stats.kind === "habit") {
      if (stats.comebackRecent) badges.push(`↺ návrat ${stats.comebackRecent === "today" ? "dnes" : "včera"}`);
      badges.push(`rekord ${stats.record} d`, `týdny v řadě ${stats.weekStreak}`, `tento týden ${stats.weekThis}/${stats.weekThreshold}`);
      if (stats.comebacks) badges.push(`návraty ${stats.comebacks}`);
    }
    if (badges.length) { const pr = pills(f, badges, col, x0, cy, iw); c.push(...pr.parts); cy = pr.y + 10; }

    if (def.why) {
      for (const l of wrap(`Proč: ${def.why}`, iw, F.body, m)) { cy += lh(F.body); c.push(txt(x0, cy - 4, l, F.body, SOFT)); }
      cy += 8;
    }
    if (stats.kind === "habit" && stats.quote) {
      const q = stats.quote;
      const lines = wrap(`„${q.text}“`, iw - 12, F.body, m).slice(0, 3);
      const qTop = cy;
      for (const l of lines) { cy += lh(F.body); c.push(txt(x0 + 12, cy - 4, l, F.body, SOFT, ` font-style="italic"`)); }
      cy += lh(F.small);
      c.push(txt(x0 + 12, cy - 4, `— ty, ${shortDate(q.date)}`, F.small, MUT));
      c.push(`<rect x="${x0}" y="${qTop + 4}" width="3" height="${cy - qTop - 6}" rx="1.5" fill="${col}"/>`);
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
    const sub = [met ? "týdenní práh splněn" : "", h.comeback ? "↺ návrat" : ""].filter(Boolean).join(" · ") || (h.def.anchor ? `kotva: ${h.def.anchor}` : undefined);
    const head = cardHead(f, h.def, x0, y + P, rw + 12, sub);
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
