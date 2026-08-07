// Minimal two-column dashboard: stat tiles + tables (deliberately not charts —
// MVP has headline numbers and enumerable facts; trends come with v0.2 data).
// Left column: local token usage. Right column: relay assets as the sites
// report them. The two are different scopes and are never merged or summed.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UsagePlane</title>
<style>
  :root {
    --bg: #f7f7f8; --surface: #ffffff; --border: #e3e3e6;
    --ink: #1a1a1f; --ink-2: #55555e; --ink-3: #8a8a94;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131316; --surface: #1c1c21; --border: #2c2c33;
      --ink: #ececf0; --ink-2: #a8a8b3; --ink-3: #6d6d78;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: var(--bg); color: var(--ink);
    font: 14px/1.5 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  header { max-width: 1080px; margin: 0 auto 20px; display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { color: var(--ink-3); font-size: 12px; }
  .cols { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
  section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; }
  h2 { font-size: 13px; margin: 0 0 12px; color: var(--ink-2); font-weight: 600; letter-spacing: .02em; }
  .tiles { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 14px; }
  .tile .num { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .tile .lbl { font-size: 12px; color: var(--ink-3); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 5px 8px 5px 0; border-top: 1px solid var(--border); font-size: 13px; }
  th { color: var(--ink-3); font-weight: 500; border-top: none; }
  td.n, th.n { text-align: right; padding-right: 0; }
  .sub { color: var(--ink-3); font-size: 12px; margin-top: 10px; }
  .relay { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 0; border-top: 1px solid var(--border); }
  .relay:first-of-type { border-top: none; }
  .relay .num { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .relay .err { color: var(--ink-2); font-size: 12px; max-width: 60%; }
  .empty { color: var(--ink-3); padding: 8px 0; }
  footer { max-width: 1080px; margin: 16px auto 0; color: var(--ink-3); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>UsagePlane</h1>
  <div class="meta" id="meta">loading…</div>
</header>
<div class="cols">
  <section>
    <h2>AI 编程用量（本地统计）</h2>
    <div class="tiles" id="usage-tiles"></div>
    <table id="devices"></table>
    <table id="models"></table>
    <div class="sub" id="projects"></div>
  </section>
  <section>
    <h2>中转站资产（站点报告值）</h2>
    <div id="relays" class="empty">loading…</div>
  </section>
</div>
<footer>两栏口径不同：左栏为本地日志统计的 token 量，右栏为中转站自报的余额/消费——二者永不相加。</footer>
<script>
const fmt = n => n >= 1e9 ? (n/1e9).toFixed(2)+"B" : n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n)
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))

async function load() {
  const [summary, relays] = await Promise.all([
    fetch("/api/summary").then(r => r.json()),
    fetch("/api/relays").then(r => r.json()),
  ])

  document.getElementById("meta").textContent =
    summary.device + " · " + new Date(summary.generated_at).toLocaleString()

  const totals = summary.tools.reduce((a, t) => ({
    tokens: a.tokens + t.total_tokens, conv: a.conv + t.conversation_count
  }), { tokens: 0, conv: 0 })
  document.getElementById("usage-tiles").innerHTML =
    tile(fmt(totals.tokens), "total tokens") + tile(String(totals.conv), "conversations") +
    summary.tools.map(t => tile(fmt(t.total_tokens), esc(t.tool))).join("")

  if (summary.devices.length > 1) {
    document.getElementById("devices").innerHTML =
      "<tr><th>device</th><th>tool</th><th class=n>total</th><th class=n>conv</th></tr>" +
      summary.devices.map(d => "<tr><td>" + esc(d.device_id) + "</td><td>" + esc(d.tool) +
        "</td><td class=n>" + fmt(d.total_tokens) + "</td><td class=n>" + d.conversation_count + "</td></tr>").join("")
  }

  const models = summary.models.filter(m => m.model !== "unknown").slice(0, 8)
  document.getElementById("models").innerHTML =
    "<tr><th>model</th><th class=n>in</th><th class=n>out</th><th class=n>total</th></tr>" +
    models.map(m => "<tr><td>" + esc(m.model) + "</td><td class=n>" + fmt(m.input_tokens) +
      "</td><td class=n>" + fmt(m.output_tokens) + "</td><td class=n>" + fmt(m.total_tokens) + "</td></tr>").join("")

  const projects = summary.projects.filter(p => p.project).slice(0, 6)
  document.getElementById("projects").textContent = projects.length
    ? "top projects: " + projects.map(p => p.project + " " + fmt(p.total_tokens)).join(" · ")
    : ""

  const relayEl = document.getElementById("relays")
  if (!relays.length) { relayEl.textContent = "未配置中转站 — 编辑 ~/.usageplane/usageplane.yaml"; return }
  relayEl.classList.remove("empty")
  relayEl.innerHTML = relays.map(r => {
    const name = esc(r.id) + " (" + esc(r.type) + ")"
    if (r.error) return relayRow(name, "", "error — " + esc(r.error))
    const bal = r.unlimited ? "unlimited" : r.balance_usd === undefined ? "n/a" : esc(r.currency) + r.balance_usd.toFixed(2)
    const sub = (r.used_usd !== undefined ? "used " + esc(r.currency) + r.used_usd.toFixed(4) + " · " : "") +
      (r.scope === "key" ? "key 口径（access token 可看账户余额）" : "账户口径")
    return relayRow(name, bal, sub)
  }).join("")
}

const tile = (num, lbl) => '<div class="tile"><div class="num">' + num + '</div><div class="lbl">' + lbl + "</div></div>"
const relayRow = (name, num, sub) =>
  '<div class="relay"><div><div>' + name + '</div><div class="err">' + sub + '</div></div><div class="num">' + num + "</div></div>"

load().catch(err => { document.getElementById("meta").textContent = "load failed: " + err })
</script>
</body>
</html>
`
