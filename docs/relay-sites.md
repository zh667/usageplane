# 中转站家族谱系与上游参考

> 摘编自 [all-api-hub](https://github.com/qixing-jk/all-api-hub) 的 AGENTS.md 领域知识章节（AGPL-3.0），去除了其仓库内部路径，保留谱系关系与兼容性边界。写 `src/relays/` 适配器前先读本文；对具体部署的行为存疑时，索要部署 URL、fork 或版本号，不要凭上游默认行为下结论。

## 谱系关系

- **One API (`one-api`)** — 原始上游家族，大量兼容部署的公共基线。
- **New API (`new-api`)** — One API 下游家族，当前最主流的中转站架构。
- **Veloera** — New API 下游，有独立差异。
- **OneHub (`one-hub`)** — One API 下游，API 表面差异较大。
- **DoneHub (`done-hub`)** — OneHub 下游，在其之上再叠差异。
- **AnyRouter / WONG公益站** — 有站点专属的 API 差异和签到逻辑，不能当作泛 new-api 别名。
- **v-api** — One API 衍生 + 部分 New API 功能，按 One-API 衍生兼容桶处理。
- **Super-API / Rix-Api / Neo-API** — New API 家族变体，下游修改程度因部署而异，不要臆测。
- **VoAPI** — 旧版按 New API 家族兼容处理；**新版不兼容**通用适配器，除非目标部署证明兼容。
- **Octopus** — 有专属逻辑，不走通用适配。
- **AxonHub** — **不兼容** One-API/New-API，走 GraphQL admin 集成。
- **Claude Code Hub** — **不兼容** One-API/New-API，专属 admin/provider 集成。
- **Sub2API** — **不兼容**，认证模型和 API 表面都不同。
- **AIHubMix** — 仅账户型站点；API origin 固定 `https://aihubmix.com`；token 认证发送裸 `Authorization: <access_token>`（无 `Bearer` 前缀）；已保存的 API key 不支持回读明文（列表返回掩码 key）。

## 适配器设计推论

- 通用适配层只覆盖 One-API/New-API 兼容桶；AxonHub、Claude Code Hub、Sub2API、新版 VoAPI 各自需要独立适配器。
- 不是所有站点都提供逐请求日志——很多只有余额/总消费。适配器能力要声明式（`supports: balance | usage_log | checkin | pricing`），上层按能力降级展示。
- 当实现依赖上游文档或实测行为时，在适配器代码旁加简短注释记录来源 URL 和所依赖的具体契约。

## 上游默认参考仓库

| 架构 | 仓库 |
|---|---|
| One API | https://github.com/songquanpeng/one-api |
| New API | https://github.com/QuantumNous/new-api |
| Veloera | https://github.com/Veloera/Veloera |
| V-API | https://github.com/popjane/v-api |
| VoAPI | https://github.com/VoAPI/VoAPI |
| Super-API | https://github.com/SuperAI-Api/Super-API |
| AnyRouter docs | https://docs.anyrouter.top/ |
| OneHub | https://github.com/MartialBE/one-hub |
| DoneHub | https://github.com/deanxv/done-hub |
| AxonHub | https://github.com/looplj/axonhub |
| Claude Code Hub | https://github.com/ding113/claude-code-hub |
| Sub2API | https://github.com/Wei-Shaw/sub2api |
| AIHubMix API docs | https://docs.aihubmix.com/en/api/Cli |
