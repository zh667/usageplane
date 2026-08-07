# UsagePlane 路线图

> 定位与架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。本文只管"接下来做什么、做到什么程度算完成"。
> 状态标记：⬜ 未开始 · 🔨 进行中 · ✅ 完成

## v0.1 — MVP：一台机器上能看到两类数据

目标：在本机跑 `usageplane serve`，浏览器里同时看到"AI 编程用量"和"中转站资产"两栏真实数据。

### M1 核心数据层（其他一切的地基）✅ 2026-08-07

- ✅ 统一记录 schema 定稿并落成 TS 类型（`src/core/types.ts`，字段见 ARCHITECTURE.md）
- ✅ 本地存储：`~/.usageplane/` + SQLite（better-sqlite3，WAL，追加式 migration，upsert 按桶键 last-write-wins）
- ✅ `usageplane.yaml` 配置加载（设备名、采集器、中转站列表；token_env 优先于明文 token）
- ✅ 附带：`usageplane init` 命令（建目录 + 起始配置 + 建库），CLI 帮助骨架

### M2 第一个采集器：Claude Code ✅ 2026-08-07

- ✅ 移植 TokenTracker 的 Claude JSONL 解析器（去重、归一化、半小时桶、cwd→项目归属，MIT 注明）
- ✅ CommonJS → ESM/TS 改写（有意简化：全量重解析替代 cursor 增量——upsert 幂等所以正确；简化处均在文件头注明）
- ✅ `usageplane sync` 命令：解析 `~/.claude` → 写入本地库
- ✅ 验收通过：70 个真实日志文件对拍，token 六列全局+分模型误差全为 0（含 14 亿 cached tokens），总对话数一致；验收脚本固化在 `scripts/compare-claude-tokentracker.mts` 可随时重跑

### M3 第一个中转站适配器：new-api 家族 ✅ 2026-08-07

- ✅ 适配器接口定稿：`supports: balance | usage_log | checkin | pricing` 能力声明 + 注册表（`src/relays/types.ts`）
- ✅ new-api/one-api 通用适配器（移植自 all-api-hub `newApiFamily/default/` + `compatHeaders.ts`，AGPL 注明；注意上游目录已从其文档写的 `common/` 改名）：余额查询、user-id 兼容头扇出、quota÷500000 换算
- ✅ 登录态方案：仅 access token（Bearer）认证（cookie 签到类推迟到 v0.2）
- ✅ `usageplane relays` 命令：逐站查询，单站失败不中断整体
- ✅ 验收通过（范围调整为 1 个站点——用户仅有一个中转站）：key 级 0.333592 与网页完全一致；账户级余额 ¥199.2064/用量 ¥0.7936 与网页后台（¥199.21/¥0.7936）一致

### M4 最小界面 ✅ 2026-08-07

- ✅ `usageplane serve`：node:http 本地 API（`/api/summary`、`/api/relays`，余额 60s 缓存），127.0.0.1:7690
- ✅ 最小 dashboard：两栏首页（用量 stat tile+模型/项目表 | 中转站余额卡片），页脚明示两栏口径永不相加；深浅色自适应
- ✅ `usageplane status`：CLI 两栏摘要（无浏览器的 VPS 场景），本地统计与站点实报分区展示
- ✅ 验收：README"What it will do"前两条在本机成立——1.41B tokens/529 会话真实统计 + 中转站余额实报（curl 三路由 + status 实跑验证；浏览器视觉复核待装 libnspr4 后补截图）

## v0.2 — 多设备与更多来源

- ⬜ Codex 采集器（注意：input 含缓存，见 CLAUDE.md token 语义）
- ⬜ 多设备聚合：VPS 装 CLI → 聚合数据上传/同步方案（方案待定：中心服务器 vs WebDAV，参考 all-api-hub 的 WebDAV 备份思路）
- ⬜ 官方订阅额度窗口（Claude Max/Pro 的 5h/周窗口）
- ⬜ 更多中转站架构：Veloera / one-hub（按 docs/relay-sites.md 谱系逐个验证）
- ⬜ 模型价格对比、可用性检测
- ⬜ cookie 登录态 + 自动签到（评估 CLI 环境下的可行性，不行就砍）

## v2 — 观望区（明确不承诺）

- ⬜ 请求级"日志↔账单"核账：仅当站点提供逐请求日志 API 且用户显式绑定。已知硬伤记录在 ARCHITECTURE.md
- ⬜ 可选本地轻代理（如果核账需求强烈，代理比日志匹配可靠）
- ⬜ 告警、预算、团队功能

## 决策日志

| 日期 | 决策 |
|---|---|
| 2026-08-07 | 定名 UsagePlane；许可证 AGPL-3.0-only（all-api-hub 传染）；不做请求代理；核账降为可选 |
| 2026-08-07 | 首个采集器选 Claude Code，首个适配器选 new-api 家族（覆盖面最大） |
| 2026-08-07 | SQLite 选 better-sqlite3：Node 22 内置 node:sqlite 仍是实验性；secrets 推荐 token_env 而非明文写进 yaml |
| 2026-08-07 | 与 TokenTracker 的有意分歧：对话数不折算进"主力模型"（用户消息无模型字段，上游做法是猜测），保持挂 model=unknown——遵循"归属绝不猜测"原则 |
| 2026-08-07 | 中转站两种凭证分流：sk- key → key 级 billing 端点；access token → 账户级 /api/user/self。RelayBalance 增加 scope 字段区分口径 |
| 2026-08-07 | 货币符号是站点自选的显示配置（同一数值有站标 $ 有站标 ¥），底层单位恒为 quota/500000。relay.currency 只管显示，永不参与换算 |
