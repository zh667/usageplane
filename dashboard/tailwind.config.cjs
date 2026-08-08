// Design tokens ported from TokenTracker dashboard/tailwind.config.cjs +
// src/styles.css (MIT) — oai font stack, green-tinted gray scale, forest
// brand green, display sizes. Values kept identical for visual parity.
/** @type {import("tailwindcss").Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        oai: [
          "'OpenAI Sans'",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "Oxygen",
          "Ubuntu",
          "sans-serif",
        ],
        mono: ["'SF Mono'", "SFMono-Regular", "ui-monospace", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      colors: {
        "oai-black": "#0a0a0a",
        "oai-white": "#fafafa",
        "oai-gray": {
          50: "#f6f9f6",
          100: "#eef4ee",
          200: "#d8e1d8",
          300: "#c0cbbf",
          400: "#95a395",
          500: "#677667",
          600: "#4d594d",
          700: "#343d34",
          800: "#1d241d",
          900: "#0f130f",
          950: "#050605",
        },
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
        amber: { DEFAULT: "#f59e0b", dark: "#d97706", light: "#fbbf24" },
        provider: {
          claude: "#d97757",
          codex: "#3b82f6",
          cursor: "#10b981",
          gemini: "#2196f3",
        },
      },
      fontSize: {
        display: ["72px", { lineHeight: "1", fontWeight: "700", letterSpacing: "-0.03em" }],
        "display-sm": ["56px", { lineHeight: "1", fontWeight: "700", letterSpacing: "-0.02em" }],
        hero: ["34px", { lineHeight: "1.15", fontWeight: "600", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
}
