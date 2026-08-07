# UsagePlane 路线图

> 定位与架构见 [ARCHITECTURE.md](ARCHITECTURE.md)；逐功能的上游对照见 [FEATURE-MAP.md](FEATURE-MAP.md)。本文只管"接下来做什么、做到什么程度算完成"。
> 对齐原则：用量侧向 TokenTracker 靠、中转站侧向 All API Hub 靠——假设我们的用户就是他们的用户，不盲目增减功能。
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
- ✅ 验收：README"What it will do"前两条在本机成立——1.41B tokens/529 会话真实统计 + 中转站余额实报（curl 三路由 + status 实跑 + Playwright 浅/深色截图视觉复核通过；VPS 截图中文需 fonts-noto-cjk，非页面问题）

## v0.2 — 多设备与更多来源

- ✅ Codex 采集器（2026-08-07）：移植 codex-token-usage 增量状态机（逐行 1:1）+ rollout 事件循环；cached-input 减除、fork 重放双守卫（突发间隙 + 跨日）、跨改写/归档去重；6 个合成夹具测试过。**对拍验收待 Windows 真实日志**（本机无 Codex 数据；Windows 装好后 push 上来即可核对）
- ✅ 多设备聚合（2026-08-07）：hub 模式——常开设备（VPS）`serve` 暴露 `POST /api/ingest`（Bearer 共享 token，无 token 配置则 403 拒收），卫星设备 `usageplane push`；幂等 upsert 免合并冲突。回环 E2E 验证双推不翻倍；dashboard/status 增加按设备分组视图
- ⬜ Codex 对拍验收：Windows 装好后 push 真实日志上来核对（v0.2 唯一悬项）

> **批次顺序（用户定，2026-08-07）：v0.4 用量侧对齐先做，云端三档（v0.3）后推。** 编号保留不改，按此顺序执行。

## v0.3 — 云端三档（后推；聚合首选，零门槛:默认假设用户没有 VPS）

三档通道，同一套协议：

1. **官方托管 hub（默认档）**：项目方运营的多租户 hub，用户零服务器。UX 完全对齐 TokenTracker：装包 → `usageplane link`（配对码/设备流，隐式建账号，不强制邮箱注册）→ `sync` 自动上传 → 官方域名随处看
   - ⬜ 多租户改造：账号体系 + 按账号数据隔离（现有 hub 是单租户共享 token，这是 v0.3 最大工作量）
   - ⬜ 托管基础设施：自有 VPS + 域名 + Let's Encrypt 起步；**上线第一天必须有异地备份和进程监控**；量大再迁 BaaS（Supabase/InsForge 类托管后端——换存储层不换产品代码，TokenTracker 用 InsForge 的先例）
   - ⬜ 隐私声明：只收 token 计数与元数据，延续 privacy 铁律
2. **自托管 hub（数据主权档）**：⬜ `usageplane hub init` 一条命令在自己 VPS 起同款 hub（systemd+HTTPS 全自动），数据不出门
3. **SSH 隧道（备用档）**：✅ 已可用；云端不可用时降级、临时拉取某台远程机器用量

## v0.4 — 用量侧对齐批次（当前批次，向 TokenTracker 靠）

**逐页详细规格：[v0.4-usage-side.md](v0.4-usage-side.md)**（含实景截图核对的要素清单、后端端点、移植来源、验收标准）。概要：

- ✅ 前端栈迁移（2026-08-07）：React+Vite+Tailwind 与上游同栈；oai 设计令牌（绿调灰阶/森林绿/72px display）、侧边栏三分组布局、暗色 class 切换；`serve` 静态托管 dist + SPA 回退（未构建时退回旧内联页）
- 🔨 常规用量页：范围切换/hero 大数字/工具占比卡/Daily Breakdown 全列/模型排名/活动热力图/中转站侧卡已上线，**首屏即呈现真实双设备合并数据（Windows Codex 58.7% + VPS Claude 41.3%）**；余：成本估算接入、Project Usage 视图、Custom 范围、图标 SVG 化
- ✅ 会话页（2026-08-07）：Claude/Codex 会话扫描（summary 优先做标题、轮次/编辑数/token 去重统计、时长）、工具/时间/搜索筛选、Copy resume command；标题只供本机页面，绝不进 hub（隐私铁律）。成本列待定价引擎
- ⬜ 限额页：Claude Max 5h/7d 窗口进度条（OAuth usage 端点 + 强制缓存退避），其余 provider 占位
- ⬜ Skills 页：My Skills 列表（跨 agent 安装矩阵）；Browse 云端库推迟
- ⬜ 设置页：Appearance 全量（主题/语言/货币/数字格式）、Account 占位、Limits Display
- ⬜ 成本估算引擎：移植定价表；estimated 与 reported 永不相加
- 后备（本批次未排）：项目归属升级 git-root、Cursor/Gemini 采集器

## v0.5 — 中转站侧对齐批次（向 All API Hub 靠）

细节见 FEATURE-MAP.md 中转站侧表：

- ⬜ 今日用量/按模型统计（`/api/log/self`，`supports: usage_log` 能力位）
- ⬜ 更多站点架构：Veloera / one-hub / Sub2API…（按 relay-sites.md 谱系逐个验证）
- ⬜ 模型价格对比、可用性检测
- ⬜ Key 管理（列出/复制/创建）与凭证导出（CherryStudio / CC Switch）
- ⬜ 站点自动识别（粘贴 URL 判断架构类型）
- ⬜ 自动签到（token 化可行的站先做；纯 cookie 站评估后可能有意不做）

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
| 2026-08-07 | 多设备聚合选 hub-push 而非 WebDAV：VPS 常开当汇聚端，复用幂等 upsert 天然免冲突；卫星设备走 SSH 隧道推 127.0.0.1 绑定的 hub |
| 2026-08-07 | port-collector skill 固化于 `.claude/skills/`（第二次移植前，按既定规则）；Codex 移植即其活体测试，流程全程可循 |
| 2026-08-07 | 否掉照搬 TokenTracker 云端 SaaS（第三方托管+账号体系，与本地优先定位冲突），取其"设备推中心 API"骨架自托管实现 |
| 2026-08-07 | 聚合通道排序（用户定）：**云端（公网 HTTPS hub）为首选，SSH 隧道为备用**。依据：TokenTracker 官方云端远程实测有问题；自托管云端数据仍在自己机器上。应用层协议不变，只是传输暴露方式升级 |
| 2026-08-07 | **定位下修门槛（用户定）：默认假设用户没有 VPS** → 云端模式必须提供官方托管 hub（多租户 SaaS，TokenTracker 模式），自托管 hub 降为"数据主权档"可选项。项目方承担托管的成本/在线率/数据保管责任 |
