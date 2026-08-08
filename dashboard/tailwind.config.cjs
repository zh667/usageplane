// Design tokens — GitHub-inspired developer control plane (2026-08-08
// visual recalibration, see docs/ROADMAP.md). Neutral scale/blue/semantic
// colors follow GitHub Primer values; the class NAMES keep the original
// oai-* prefix so the recalibration is a token swap, not a class churn.
// The faint green page canvas stays as UsagePlane's identity accent.
/** @type {import("tailwindcss").Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        oai: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "'Noto Sans'",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "'SF Mono'", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        "oai-black": "#1f2328", // fg-default
        "oai-white": "#e6edf3", // dark fg-default
        "oai-gray": {
          // Light neutrals (GitHub Primer); 100 keeps a whisper of green —
          // it is the page canvas and our one intentional brand deviation.
          50: "#f6f8fa",
          100: "#f2f6f3",
          200: "#d0d7de",
          300: "#afb8c1",
          400: "#8c959f",
          500: "#656d76",
          600: "#57606a",
          // Dark surfaces
          700: "#30363d", // dark border
          800: "#21262d", // dark raised surface
          900: "#161b22", // dark card surface
          950: "#0d1117", // dark canvas
        },
        accent: { DEFAULT: "#0969da", dark: "#2f81f7" },
        brand: {
          // Forest green kept for identity accents (est. cost, positive states)
          50: "#ecfdf5",
          100: "#d1fae5",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
        success: { DEFAULT: "#1a7f37", dark: "#3fb950" },
        warn: { DEFAULT: "#9a6700", dark: "#d29922" },
        danger: { DEFAULT: "#cf222e", dark: "#f85149" },
        amber: { DEFAULT: "#9a6700", 500: "#bf8700", 600: "#9a6700", dark: "#d29922", light: "#bf8700" },
        provider: {
          claude: "#d97757",
          codex: "#3b82f6",
          cursor: "#10b981",
          gemini: "#2196f3",
        },
      },
      fontSize: {
        // KPI numbers: dashboard exception, capped at 56px per calibration.
        display: ["56px", { lineHeight: "1", fontWeight: "700", letterSpacing: "-0.02em" }],
        "display-sm": ["48px", { lineHeight: "1", fontWeight: "700", letterSpacing: "-0.02em" }],
        hero: ["30px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        card: "6px",
      },
      maxWidth: {
        page: "1200px",
        "page-wide": "1680px",
      },
    },
  },
  plugins: [],
}
