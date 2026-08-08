// Activity heatmap semantics — ported from TokenTracker
// dashboard/src/lib/activity-heatmap.ts + ActivityHeatmap.jsx palettes (MIT):
// Sunday-aligned 52-week UTC grid, P50/P75/P90 quantile levels over the
// ACTIVE days only (a single spike cannot crush the rest into level 1),
// and five concrete hex colors per theme — never framework color tokens,
// so a palette refactor can't silently render active cells transparent.

export const HEATMAP_COLORS_LIGHT = [
  "#ebedf0", // level 0 — inactive, GitHub-style neutral
  "#a7f3d0",
  "#6ee7b7",
  "#34d399",
  "#10b981",
]

export const HEATMAP_COLORS_DARK = [
  "#121212", // level 0 — inactive
  "#065f46",
  "#059669",
  "#10b981",
  "#34d399",
]

const DAY_MS = 86400000

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim())
  if (!m) return null
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isFinite(dt.getTime()) ? dt : null
}

const fmtUtc = (dt) => dt.toISOString().slice(0, 10)
const addDays = (dt, n) => new Date(dt.getTime() + n * DAY_MS)

function quantile(sorted, q) {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const left = sorted[base]
  const right = sorted[Math.min(sorted.length - 1, base + 1)]
  return Math.round(left + (right - left) * rest)
}

/**
 * Build the 52×7 grid. `days` is the /api/heatmap shape
 * ([{day, total_tokens}]); `to` defaults to today (UTC). Slots after `to`
 * are null — they must not render as interactive cells.
 */
export function buildActivityHeatmap({ days = [], weeks = 52, to } = {}) {
  const end = parseDay(to) ?? parseDay(new Date().toISOString().slice(0, 10))
  // Sunday-align the start: back to the Sunday of `end`'s week, then 51 weeks further.
  const endWeekStart = addDays(end, -end.getUTCDay())
  const start = addDays(endWeekStart, -7 * (weeks - 1))

  const valueByDay = new Map()
  for (const row of days) {
    const day = typeof row?.day === "string" ? row.day : null
    if (!day) continue
    const v = Number(row.total_tokens)
    valueByDay.set(day, Number.isFinite(v) ? Math.max(0, v) : 0)
  }

  // Quantiles over active days INSIDE the window only.
  const active = []
  const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  for (let i = 0; i < totalDays; i++) {
    const v = valueByDay.get(fmtUtc(addDays(start, i))) ?? 0
    if (v > 0) active.push(v)
  }
  active.sort((a, b) => a - b)
  const t1 = quantile(active, 0.5)
  const t2 = quantile(active, 0.75)
  const t3 = quantile(active, 0.9)
  const levelFor = (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4)

  const out = []
  for (let w = 0; w < weeks; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const dt = addDays(start, w * 7 + d)
      if (dt.getTime() > end.getTime()) {
        week.push(null)
        continue
      }
      const day = fmtUtc(dt)
      const value = valueByDay.get(day) ?? 0
      week.push({ day, value, level: levelFor(value) })
    }
    out.push(week)
  }

  return { from: fmtUtc(start), to: fmtUtc(end), weeks: out, thresholds: { t1, t2, t3 } }
}

/** Month label per week column: set where the month changes (upstream style). */
export function monthLabels(weeksGrid) {
  const labels = []
  let prev = ""
  for (const week of weeksGrid) {
    const first = week.find(Boolean)
    if (!first) {
      labels.push("")
      continue
    }
    const month = first.day.slice(0, 7)
    if (month !== prev) {
      prev = month
      labels.push(new Date(`${first.day}T00:00:00Z`).toLocaleString("en", { month: "short", timeZone: "UTC" }))
    } else {
      labels.push("")
    }
  }
  return labels
}
