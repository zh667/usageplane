// Display preferences, persisted in localStorage. Mirrors TokenTracker's
// Settings → Appearance set: theme / language / currency / token numbers.
const KEYS = {
  theme: "usageplane-theme", // "light" | "dark" | "system"
  numbers: "usageplane-numbers", // "compact" | "full"
  currency: "usageplane-currency", // "USD" | "CNY"
  limitsDisplay: "usageplane-limits-display", // "used" | "left"
}

export function getPref(name, fallback) {
  return localStorage.getItem(KEYS[name]) ?? fallback
}

export function setPref(name, value) {
  localStorage.setItem(KEYS[name], value)
  if (name === "theme") applyTheme()
}

export function applyTheme() {
  const theme = getPref("theme", "system")
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}
