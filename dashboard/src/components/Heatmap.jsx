// GitHub-style activity heatmap (own implementation of the TokenTracker
// ActivityHeatmap concept): ~6 months of UTC days, brand-green scale.
const LEVELS = ["bg-oai-gray-100 dark:bg-oai-gray-800", "bg-brand-200", "bg-brand-300", "bg-brand-500", "bg-brand-700"]
const WEEKS = 26
const DAY_MS = 24 * 3600 * 1000

export default function Heatmap({ days }) {
  const byDay = new Map(days.map((d) => [d.day, d.total_tokens]))
  const max = Math.max(1, ...days.map((d) => d.total_tokens))

  const today = new Date()
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const endDow = new Date(end).getUTCDay()
  const start = end - ((WEEKS - 1) * 7 + endDow) * DAY_MS

  const weeks = []
  for (let w = 0; w < WEEKS; w++) {
    const col = []
    for (let dow = 0; dow < 7; dow++) {
      const t = start + (w * 7 + dow) * DAY_MS
      if (t > end) break
      const key = new Date(t).toISOString().slice(0, 10)
      const v = byDay.get(key) ?? 0
      const level = v === 0 ? 0 : 1 + Math.min(3, Math.floor((v / max) * 4))
      col.push({ key, v, level })
    }
    weeks.push(col)
  }

  const monthLabels = weeks.map((col, i) => {
    const d = new Date(start + i * 7 * DAY_MS)
    return d.getUTCDate() <= 7 ? d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase() : ""
  })

  return (
    // min-w keeps cells legible; narrow viewports scroll inside the card
    // instead of stretching the whole page column past the viewport.
    <div className="overflow-x-auto">
      <div className="min-w-[300px]">
      <div className="mb-1 grid grid-flow-col gap-[3px] text-[9px] text-oai-gray-400" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
        {monthLabels.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
        {weeks.map((col, i) => (
          <div key={i} className="grid gap-[3px]" style={{ gridTemplateRows: "repeat(7, 1fr)" }}>
            {col.map((cell) => (
              <div
                key={cell.key}
                title={`${cell.key} · ${cell.v.toLocaleString()} tokens`}
                className={`aspect-square w-full rounded-[2px] ${LEVELS[cell.level]}`}
              />
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
