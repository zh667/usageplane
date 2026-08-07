# UsagePlane 路线图

> 定位与架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。本文只管"接下来做什么、做到什么程度算完成"。
> 状态标记：⬜ 未开始 · 🔨 进行中 · ✅ 完成

## v0.1 — MVP：一台机器上能看到两类数据

目标：在本机跑 `usageplane serve`，浏览器里同时看到"AI 编程用量"和"中转站资产"两栏真实数据。

### M1 核心数据层（其他一切的地基）

- ⬜ 统一记录 schema 定稿并落成 TS 类型（`src/core/types.ts`，字段见 ARCHITECTURE.md）
- ⬜ 本地存储：`~/.usageplane/` 目录结构 + SQLite（参考 TokenTracker 的 queue.jsonl→读取模式，但直接上 SQLite 省一次迁移）
- ⬜ `usageplane.yaml` 配置加载（设备名、启用的采集器、中转站列表）

### M2 第一个采集器：Claude Code

- ⬜ 移植 TokenTracker 的 Claude JSONL 解析器（`src/lib/rollout.js` 中 claude 部分 + `claudeMessageDedupKey` 去重，MIT 注明）
- ⬜ CommonJS → ESM/TS 改写
- ⬜ `usageplane sync` 命令：解析 `~/.claude` → 写入本地库
- 验收：与 TokenTracker 对同一份日志的统计结果一致（token 各分列误差为 0）

### M3 第一个中转站适配器：new-api 家族

- ⬜ 适配器接口定稿：`supports: balance | usage_log | checkin | pricing` 能力声明
- ⬜ new-api/one-api 通用适配器（参考 all-api-hub `src/services/apiService/common/`，AGPL 注明）：余额 + 总消费查询
- ⬜ 登录态方案：先只支持 access token / API key 认证（cookie 签到类功能推迟到 v0.2）
- 验收：对你实际在用的 2 个中转站能查到余额，数字与网页后台一致

### M4 最小界面

- ⬜ `usageplane serve`：本地 HTTP API（参考 TokenTracker `local-api.js` 的路由风格）
- ⬜ 最小 dashboard：两栏首页（用量 | 资产），estimated 与 reported 分开展示
- ⬜ `usageplane status`:CLI 里直接打印两栏摘要（没有浏览器的 VPS 场景）
- 验收：README 的"What it will do"第一、二条在本机成立

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
