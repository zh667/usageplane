# CLAUDE.md

Guidance for Claude Code working in this repository. Every line here is loaded into every conversation turn — keep it lean and current.

## Project shape

UsagePlane — a local-first control plane for AI coding usage, subscription limits, and relay account assets（跨设备 AI 用量 + 多中转站资产的统一控制台）。

- `src/cli.ts` — CLI 入口（命令名 `usageplane`）
- `src/collectors/` — 客户端日志采集器（Claude Code、Codex 等），移植目标：TokenTracker `src/lib/`
- `src/relays/` — 中转站适配器（new-api/one-api 家族等），移植目标：all-api-hub `src/services/apiService/`
- `src/core/` — 统一数据模型与本地存储（数据目录 `~/.usageplane`，配置 `usageplane.yaml`）
- `src/server/` — 本地 HTTP API，供 `dashboard/` 使用
- `dashboard/` — Web 面板（未开始）

**Status: skeleton — 尚无可运行代码。** 设计与路线图见 `docs/ARCHITECTURE.md`。

## Upstream provenance（载荷级约定）

- 本项目许可证为 **AGPL-3.0-only**，因为 `src/relays/` 移植 all-api-hub（AGPL-3.0）代码。不得改为宽松许可证。
- 上游参考仓库在 `~/projects/reference/TokenTracker`（MIT）和 `~/projects/reference/all-api-hub`（AGPL-3.0），浅克隆，`git pull` 更新。
- 从上游复制或移植代码时，文件头注明来源，例如：
  `// Ported from all-api-hub src/services/apiService/common/ (AGPL-3.0)`
  `// Ported from TokenTracker src/lib/rollout.js (MIT)`
- all-api-hub 是浏览器扩展，依赖用户登录态（cookie/session）；移植到 CLI/服务端时登录态管理需要重写，只有端点适配知识可以直接搬。

## Load-bearing conventions

### Token normalization（继承自 TokenTracker——移植的解析器假定这套语义）

```
input_tokens                = 非缓存输入（不含 cache 读写）
cached_input_tokens         = cache 读
cache_creation_input_tokens = cache 写
reasoning_output_tokens     = 推理 token
total_tokens                = 以上各列之和 + output_tokens
```

成本只从各分列计算，**永不从 `total_tokens` 计算**。新增采集器时先核对上游 `input_tokens` 语义（Codex 系的 input 含缓存，直接照搬会虚高 6–7×）。

### 数据口径

- 每条用量记录带 `source_kind: official_subscription | direct_api | relay | unknown`。不确定来源就归 `unknown`，绝不猜测归属。
- `estimated_cost`（按官方单价估算）与 `reported_cost`（中转站实扣）分开存储，**任何界面都不得相加**。
- 请求级"日志 ↔ 中转站账单"关联是可选功能，仅在用户显式绑定后启用。
- **Privacy**: 只存 token 计数与元数据——永不存 prompt、消息或会话内容。

### 工程约定

- TypeScript（strict）+ Node ≥ 20，ESM。TokenTracker 的 CommonJS 代码移植时转成 ESM/TS。
- Git 提交英文、conventional style（`feat:` / `fix:` / `docs:` / `chore:` / `test:`）。
- 环境变量前缀 `USAGEPLANE_`。

## Domain knowledge

中转站家族谱系（one-api → new-api → Veloera…，哪些不兼容）与上游仓库列表：`docs/relay-sites.md`。写适配器前先读它，不要凭记忆猜站点行为。
