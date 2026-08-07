# UsagePlane 架构设计（草案）

## 定位

> 一个同时管理"跨设备 AI 编程工具用量"和"多中转站 API 资产"的统一平台；请求级中转归因与账单核对是可选增强功能，不是默认假设。

不做请求代理（不在数据路径上），只做观测与管理——这是 "control plane" 名字的由来，也是与 claude-relay-service / LiteLLM 等代理方案的边界。

## 三层结构

```
采集层（借鉴 TokenTracker, MIT）
  本机/VPS 的 Claude Code、Codex 等客户端日志 → 归一化 token 记录
                    ↓
统一数据与关联层（原创核心）
  统一 schema · source_kind 归属 · 去重 · 可选核账
                    ↑
资产层（借鉴 all-api-hub, AGPL-3.0）
  中转站账户、Key、余额、消费、价格、签到、可用性
```

## 统一记录 schema（草案）

```
device_id        设备（如 "vps-tokyo"）
tool             claude-code | codex | cursor | ...
project          项目路径/名
source_kind      official_subscription | direct_api | relay | unknown
relay_id?        绑定的中转站（仅 relay 且用户显式绑定后）
account_id?      站点账户
credential_id?   Key 的不可逆指纹
model
input_tokens / output_tokens / cached_input_tokens /
cache_creation_input_tokens / reasoning_output_tokens / total_tokens
estimated_cost   按官方单价估算（可能仅为等价成本）
reported_cost?   中转站实际扣费（仅站点提供时）
timestamp        UTC
```

铁律：`estimated_cost` 与 `reported_cost` 是两种口径，任何聚合视图不得相加。

## 首页信息架构

```
AI 编程用量                     中转站资产
├─ Windows Codex               ├─ 中转站 A：余额 ¥30
├─ VPS Claude                  ├─ 中转站 B：余额 ¥12
└─ macOS Cursor                └─ 中转站 C：本月消费 ¥8
```

## 路线图

任务级路线图与验收标准见 [ROADMAP.md](ROADMAP.md)。粗线条：

- **v0.1（MVP）**：统一存储 + Claude Code 采集器 + new-api 家族余额适配 + 最小 dashboard，单机跑通。
- **v0.2**：Codex 采集器、多设备聚合、订阅额度窗口、更多站点架构、签到与价格对比。
- **v2（观望）**：可选请求级核账引擎——仅对提供逐请求日志的站点 + 用户显式绑定生效。已知硬伤：Claude Code JSONL 不记录 base_url，只能靠配置快照推断；多数中转站无逐请求日志 API。若需求强烈，考虑可选本地轻代理而非日志匹配。

## 已调研的相邻项目（为何空位存在）

- 客户端用量侧：TokenTracker、CCDash、claude-usage、ccusage — 不管中转站资产。
- 中转站资产侧：all-api-hub — 浏览器扩展，不采集客户端用量。
- 代理侧：claude-relay-service、claude-code-hub、LiteLLM — 用"进入请求链路"解决统计，与本项目定位互补。
