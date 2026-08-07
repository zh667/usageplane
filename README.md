# UsagePlane

**One control plane for all your AI usage.**

A local-first control plane for AI coding usage, subscription limits, and relay account assets.

一个本地优先的 AI 用量控制台，统一管理本机、VPS、官方订阅和多个 API 中转站。

> ⚠️ Status: early skeleton — nothing works yet. Design notes in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What it will do

- **AI 编程用量**：采集 Claude Code、Codex CLI 等工具在各设备（含 VPS）上的 token 用量、模型、项目维度统计，以及官方订阅额度窗口。
- **中转站资产**：统一管理多个 new-api / one-api 家族中转站的账户、Key、余额、消费、模型价格与可用性。
- **统一视图，口径分明**：两类数据并列展示，估算成本（estimated）与实际扣费（reported）永不混算。请求级归因是可选高级功能，不是默认假设。

## Layout

```
src/
├── cli.ts          CLI 入口
├── commands/       init / sync / serve / status
├── collectors/     客户端日志采集器（移植自 TokenTracker, MIT）
├── relays/         中转站适配器（参考 all-api-hub, AGPL-3.0）
├── core/           统一数据模型与本地存储（~/.usageplane）
└── server/         本地 HTTP API
dashboard/          Web 面板（未开始）
docs/               架构与领域知识
```

## Multi-device quickstart

Hub（常开设备，如 VPS）的 `~/.usageplane/usageplane.yaml`：

```yaml
hub:
  token: <共享密钥>
```

卫星设备（如 Windows）：

```yaml
collectors:
  - codex          # 或 claude-code
hub:
  url: http://127.0.0.1:7690   # 经 SSH 隧道: ssh -L 7690:127.0.0.1:7690 user@hub
  token: <同一个共享密钥>
```

然后在卫星设备上 `usageplane sync && usageplane push`——hub 的 dashboard 即出现按设备分组的合并视图。重复 push 安全（幂等 upsert）。

## Acknowledgements

Built on the shoulders of:

- [TokenTracker](https://github.com/xiufengsun/TokenTracker) (MIT) — client-side usage collection
- [All API Hub](https://github.com/qixing-jk/all-api-hub) (AGPL-3.0) — relay site adapters & domain knowledge

## License

[AGPL-3.0-only](LICENSE). This project ports code from All API Hub (AGPL-3.0), which requires the combined work to be AGPL-3.0.
