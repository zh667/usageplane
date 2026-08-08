import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildActivityHeatmap,
  HEATMAP_COLORS_DARK,
  HEATMAP_COLORS_LIGHT,
  // eslint-disable-next-line import/no-relative-packages
} from "../dashboard/src/lib/activity-heatmap.js"

const TO = "2026-08-08" // a Saturday

function build(days: { day: string; total_tokens: number }[]) {
  return buildActivityHeatmap({ days, to: TO })
}

test("grid is exactly 52 weeks x 7 slots with continuous UTC dates", () => {
  const { weeks } = build([])
  assert.equal(weeks.length, 52)
  for (const w of weeks) assert.equal(w.length, 7)

  const cells = weeks.flat().filter(Boolean) as { day: string }[]
  // Start is Sunday-aligned: the Sunday of `to`'s week (2026-08-02 for this
  // Saturday), minus 51 further weeks.
  assert.equal(cells[0].day, "2025-08-10")
  assert.equal(new Date("2025-08-10T00:00:00Z").getUTCDay(), 0, "start is a Sunday")
  // Dates are consecutive with no holes.
  for (let i = 1; i < cells.length; i++) {
    const prev = Date.parse(`${cells[i - 1].day}T00:00:00Z`)
    assert.equal(Date.parse(`${cells[i].day}T00:00:00Z`) - prev, 86400000, `gap at ${cells[i].day}`)
  }
})

test("last valid cell is `to`; days after it stay null (not rendered/interactive)", () => {
  const { weeks } = build([])
  const valid = weeks.flat().filter(Boolean) as { day: string }[]
  assert.equal(valid[valid.length - 1].day, TO)

  // A mid-week `to` (Wednesday) leaves the rest of its week as null slots.
  const mid = buildActivityHeatmap({ days: [], to: "2026-08-05" })
  const lastWeek = mid.weeks[mid.weeks.length - 1]
  assert.equal(lastWeek[3]?.day, "2026-08-05")
  assert.deepEqual(lastWeek.slice(4), [null, null, null], "days after `to` are null slots")
})

test("quantile levels: a huge spike does not crush other active days into level 1", () => {
  const days = [
    { day: "2026-08-01", total_tokens: 10 },
    { day: "2026-08-02", total_tokens: 20 },
    { day: "2026-08-03", total_tokens: 30 },
    { day: "2026-08-04", total_tokens: 40 },
    { day: "2026-08-05", total_tokens: 50 },
    { day: "2026-08-06", total_tokens: 60 },
    { day: "2026-08-07", total_tokens: 1_000_000_000 }, // the spike
  ]
  const { weeks } = build(days)
  const byDay = new Map(
    (weeks.flat().filter(Boolean) as { day: string; level: number }[]).map((c) => [c.day, c.level]),
  )
  const levels = new Set(days.map((d) => byDay.get(d.day)))
  for (const l of [1, 2, 3, 4]) assert.ok(levels.has(l), `level ${l} present despite the spike`)
})

test("both palettes: five valid, distinct, non-transparent colors", () => {
  for (const palette of [HEATMAP_COLORS_LIGHT, HEATMAP_COLORS_DARK]) {
    assert.equal(palette.length, 5)
    assert.equal(new Set(palette.map((c: string) => c.toLowerCase())).size, 5, "colors are distinct")
    for (const c of palette) assert.match(c, /^#[0-9a-fA-F]{6}$/, `${c} is a concrete hex color`)
  }
})

test("zero-value and missing days are level 0 with value 0", () => {
  const { weeks } = build([{ day: "2026-08-01", total_tokens: 0 }])
  const cells = weeks.flat().filter(Boolean) as { day: string; value: number; level: number }[]
  const aug1 = cells.find((c) => c.day === "2026-08-01")!
  assert.equal(aug1.level, 0)
  assert.equal(aug1.value, 0)
  const missing = cells.find((c) => c.day === "2026-07-01")!
  assert.equal(missing.level, 0)
})

test("data outside the 52-week window is ignored, not crashed on", () => {
  const { weeks } = build([{ day: "2020-01-01", total_tokens: 999 }])
  const cells = weeks.flat().filter(Boolean) as { value: number }[]
  assert.ok(cells.every((c) => c.value === 0))
})
