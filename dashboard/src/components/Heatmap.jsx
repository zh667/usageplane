// GitHub-style activity heatmap — layout semantics ported from TokenTracker
// ActivityHeatmap.jsx (MIT, 2D only): 12px cells, 3px gaps, per-week month
// labels, weekday labels, five-step Less/More legend, and an auto-scroll to
// the newest date. Level math and the concrete palettes live in
// ../lib/activity-heatmap.js — no framework color tokens involved.
import { useEffect, useMemo, useRef, useState } from "react"
import {
  buildActivityHeatmap,
  HEATMAP_COLORS_DARK,
  HEATMAP_COLORS_LIGHT,
  monthLabels,
} from "../lib/activity-heatmap.js"

const CELL = 12
const GAP = 3
const LABEL_W = 28

/** The theme toggle flips a class on <html> without re-rendering React —
 *  observe it so the palette follows the theme live. */
function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    )
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export default function Heatmap({ days }) {
  const isDark = useIsDark()
  const colors = isDark ? HEATMAP_COLORS_DARK : HEATMAP_COLORS_LIGHT
  const scrollRef = useRef(null)

  const grid = useMemo(() => buildActivityHeatmap({ days: days ?? [] }), [days])
  const months = useMemo(() => monthLabels(grid.weeks), [grid])

  // Newest dates live at the right edge — land there on mount and reload.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [grid])

  const colTemplate = `repeat(${grid.weeks.length}, ${CELL}px)`

  return (
    <div>
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div style={{ width: LABEL_W + grid.weeks.length * (CELL + GAP) - GAP }}>
          {/* month labels */}
          <div
            className="mb-1 grid text-[9px] text-oai-gray-400"
            style={{ gridTemplateColumns: colTemplate, columnGap: GAP, marginLeft: LABEL_W }}
          >
            {months.map((m, i) => (
              <span key={i} className="overflow-visible whitespace-nowrap">
                {m}
              </span>
            ))}
          </div>
          <div className="flex">
            {/* weekday labels */}
            <div
              className="grid shrink-0 text-[9px] text-oai-gray-400"
              style={{ width: LABEL_W, gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}
            >
              {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                <span key={i} className="leading-[12px]">
                  {d}
                </span>
              ))}
            </div>
            {/* cells */}
            <div className="grid grid-flow-col" style={{ gridTemplateColumns: colTemplate, columnGap: GAP }}>
              {grid.weeks.map((week, wi) => (
                <div key={wi} className="grid" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, rowGap: GAP }}>
                  {week.map((cell, di) =>
                    cell ? (
                      <div
                        key={cell.day}
                        title={`${cell.day} · ${cell.value.toLocaleString()} tokens`}
                        className="rounded-[2px]"
                        style={{ width: CELL, height: CELL, background: colors[cell.level] }}
                      />
                    ) : (
                      <div key={`empty-${wi}-${di}`} style={{ width: CELL, height: CELL }} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* legend */}
      <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-oai-gray-400">
        <span className="mr-0.5">Less</span>
        {colors.map((c) => (
          <span key={c} className="inline-block rounded-[2px]" style={{ width: 10, height: 10, background: c }} />
        ))}
        <span className="ml-0.5">More</span>
      </div>
    </div>
  )
}
