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

**Status: skeleton — 尚无可运行代码。** 架构见 `docs/ARCHITECTURE.md`，当前做到哪一步看 `docs/ROADMAP.md`（完成任务后更新状态标记）。

## Upstream provenance（载荷级约定）

- 本项目许可证为 **AGPL-3.0-only**，因为 `src/relays/` 移植 all-api-hub（AGPL-3.0）代码。不得改为宽松许可证。
- 上游参考仓库在 `~/projects/reference/TokenTracker`（MIT）和 `~/projects/reference/all-api-hub`（AGPL-3.0），浅克隆，`git pull` 更新。
- 从上游复制或移植代码时，文件头注明来源，例如：
  `// Ported from all-api-hub src/services/apiService/common/ (AGPL-3.0)`
  `// Ported from TokenTracker src/lib/rollout.js (MIT)`
- all-api-hub 是浏览器扩展，依赖用户登录态（cookie/session）；移植到 CLI/服务端时登录态管理需要重写，只有端点适配知识可以直接搬。

## 实现策略：先找轮子，再造轮子

### 设计决策先侦察上游（载荷级——已三次因违反返工）

**假设我们的用户就是 TokenTracker 和 All API Hub 的用户。** 用量侧的一切（功能、页面、UX、机制、数据来源）默认答案在 TokenTracker 里；中转站侧默认答案在 all-api-hub 里。动手设计前先侦察上游怎么做的：读源码 + 实跑对照（TokenTracker 可在本机跑起来并排对比，`node bin/tracker.js serve --no-sync` → :7680）。自创设计只允许两种情况：上游没有该功能，或与我们独有定位（用量+资产缝合层、数据主权分档）冲突。逐功能台账：`docs/FEATURE-MAP.md`。

引以为戒的三次返工：自动采集提议 cron → 上游用 **hooks**（init 装进 AI 工具配置，事件驱动）；云端 UX 让用户手配反代 → 上游是 **device-login 命令流**（运维包进命令）；Codex 会话标题从内容拼 → 上游读 **session_index.jsonl**（agent 自写的元数据）。共性：先问"TokenTracker/AAH 是怎么做的"，再动键盘。

### 审计项校准（载荷级——防审计驱动的过度设计）

外部审计/评审发现**不直接照单全收**。每条先做两个验证再动手：

1. **真伪**：在我们的代码里实际复现（或证伪）该问题；
2. **上游对照**：TokenTracker/all-api-hub 对同一问题的真实做法是什么（读源码，不凭审计描述）。

上游没有做的加固，默认答复"**有意不做（与上游同标准）**"并在回复中给出上游依据；只有三种情况接受超出上游的修复：①我们的设计分歧引入了上游不存在的风险（例：无 SSOT 的 linkSkill 必须 realpath 防链式，TT 靠 SSOT 天然免疫）②多设备/hub 带来上游没有的暴露面③改动成本≈0 且不增加维护面。已接受的超标加固不回退但**不再继续加码**（记录见 ROADMAP 2026-08-08 校准决策）。

### 代码复用

- 功能与上游重合时，**优先移植或仿写上游代码**，不从零写——它们的实现踩过的坑都在代码里。
- 其他功能先搜现有开源实现（GitHub / npm）。npm 有成熟维护的包就直接装依赖，连移植都省；只有参考价值的仓库浅克隆到 `~/projects/reference/<name>` 再移植。
- 优先级：**成熟依赖 > 移植现有代码 > 自写**。自写只留给统一数据模型这类本项目的原创核心。
- 复制任何代码前先查许可证与 AGPL-3.0 的兼容性：MIT / Apache-2.0 / BSD / MPL / (L)GPL / AGPL 可以复制（照 Upstream provenance 规则注明来源）；专有、无 LICENSE 或不兼容协议的**只能看思路重写，不能复制**。

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
- **Privacy**: 永不存储/传输 prompt、消息正文或会话内容。会话**元数据**（agent 自动生成的标题、计数、时长）可在用户自己的设备与自托管 hub 间同步（2026-08-07 用户决策）；将来官方托管 hub（多租户）上线时，会话元数据同步必须改为显式 opt-in。

### 工程约定

- TypeScript（strict）+ Node ≥ 20，ESM。TokenTracker 的 CommonJS 代码移植时转成 ESM/TS。
- Git 提交英文、conventional style（`feat:` / `fix:` / `docs:` / `chore:` / `test:`）。
- 环境变量前缀 `USAGEPLANE_`。

## Domain knowledge

中转站家族谱系（one-api → new-api → Veloera…，哪些不兼容）与上游仓库列表：`docs/relay-sites.md`。写适配器前先读它，不要凭记忆猜站点行为。
