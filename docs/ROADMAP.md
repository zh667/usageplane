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
- ✅ Codex 对拍验收（2026-08-08，Windows 实测）：五个原始 token 分栏对 TT 生产账本 **全部误差 0**（全局+按模型）。唯一残差在 TT 存量账本的 `total_tokens` 列（-86,968，其自身也不等于自家分栏之和——TT 旧版本历史漂移）；脚本已改为分栏严格对拍 + 总数按公式重算，不再信任 TT 存储总数

> **批次顺序（用户定，2026-08-07）：v0.4 用量侧对齐先做，云端三档（v0.3）后推。** 编号保留不改，按此顺序执行。

## v0.3 — 云端三档（后推；聚合首选，零门槛:默认假设用户没有 VPS）

三档通道，同一套协议：

1. **官方托管 hub（默认档）**：项目方运营的多租户 hub，用户零服务器。UX 完全对齐 TokenTracker：装包 → `usageplane link`（配对码/设备流，隐式建账号，不强制邮箱注册）→ `sync` 自动上传 → 官方域名随处看
   - ⬜ 多租户改造：账号体系 + 按账号数据隔离（现有 hub 是单租户共享 token，这是 v0.3 最大工作量）
   - ⬜ 托管基础设施：自有 VPS + 域名 + Let's Encrypt 起步；**上线第一天必须有异地备份和进程监控**；量大再迁 BaaS（Supabase/InsForge 类托管后端——换存储层不换产品代码，TokenTracker 用 InsForge 的先例）
   - ⬜ 隐私声明：只收 token 计数与元数据，延续 privacy 铁律
   - ⬜ **会话元数据 = 端到端加密盲存（用户定，2026-08-08）**：托管 hub 只存设备端加密的密文（密钥仅存于用户设备，配对时派生），hub 网页端不显示任何会话——技术上不可能显示，非策略性不显示；跨设备会话浏览由设备端拉密文本地解密实现；默认关闭、显式 opt-in。法理依据：同一用户设备间同步是隐私权的行使；风险只在途经的第三方，盲存把第三方变成"睁眼瞎"
2. **自托管 hub（数据主权档）**：⬜ `usageplane hub init` 一条命令在自己 VPS 起同款 hub（systemd+HTTPS 全自动），数据不出门
3. **SSH 隧道（备用档）**：✅ 已可用；云端不可用时降级、临时拉取某台远程机器用量

## v0.4 — 用量侧对齐批次（当前批次，向 TokenTracker 靠）

**逐页详细规格：[v0.4-usage-side.md](v0.4-usage-side.md)**（含实景截图核对的要素清单、后端端点、移植来源、验收标准）。概要：

- ✅ 前端栈迁移（2026-08-07）：React+Vite+Tailwind 与上游同栈；oai 设计令牌（绿调灰阶/森林绿/72px display）、侧边栏三分组布局、暗色 class 切换；`serve` 静态托管 dist + SPA 回退（未构建时退回旧内联页）
- ✅ 常规用量页：范围切换/hero 大数字+成本估算/工具占比卡/Daily Breakdown 全列/模型排名/活动热力图/中转站侧卡，**首屏即真实双设备合并数据**。已知口径差异：我们 Day/Week/Month 是滚动窗口，TT 是日历口径——与 TT 对拍成本时需换算。余留 polish：Project Usage 视图、Custom 范围、图标 SVG 化（v0.5）
- ✅ 会话页（2026-08-07）：Claude/Codex 会话扫描（summary 优先做标题、轮次/编辑数/token 去重统计、时长）、工具/时间/搜索筛选、Copy resume command；标题只供本机页面，绝不进 hub（隐私铁律）。成本列待定价引擎
- ✅ 限额页（2026-08-08）：Claude OAuth usage 端点（5h/7d/按模型 scoped weekly 三类窗口全解析）+ 120s 缓存 + 429/503 退避持久化（该端点与 Claude Code 共享配额，低频是硬约束）；%used/%left 跟随 Settings 偏好；Codex/Cursor/Gemini 占位。实测：5h 27% / 7d 15% / Fable 26% 与 TT 同源一致
- ✅ Skills 页（2026-08-08；扫描重做 2026-08-08 晚，Windows 实测暴露漏扫）：发现语义全面对齐 TT skills-manager——①入口判定 `isDirectory()||isSymbolicLink()`（Windows junction 报告为 symlink，之前全部漏掉）②标记接受 `SKILL.md`/`skill.md` 两种拼写、stat 穿透链接③用户目录递归 3 层支持分组、点目录（`.system` 内置）有意排除（上游同规则）④新增 `~/.agents/skills` 共享根（上游隐藏目标）；**`~/.skills` 上游不认，我们也不扫**⑤插件缓存单独盘点（`plugins/cache` 深度 6 找 `skills` 目录、剥离版本号防升级重复、`scope:"plugin"` 只读展示绝不当用户安装项）。跨设备展示改为显式 `installs:[{device,agents}]` 矩阵——本机也标注设备名，任何设备看同一技能显示一致；页面加 User/Plugin 来源筛选。Browse tab 占位（随 v0.3）；管理操作（启停/删除）v0.5
- ✅ 设置页（2026-08-07）：Appearance（主题三态/货币/数字格式，实测生效）、Account（设备名+hub 状态+登录占位）、Limits Display（%used/%left 偏好，供 Limits 页用）、版本页脚。语言项有意推迟——UI 未做 i18n 前放一个不生效的选择器是假设置（TT 对齐的例外按"上游有而我们暂缺基建"处理）
- ✅ 成本估算引擎（2026-08-08）：移植 TT 定价表（67 模型 exact+alias+fuzzy 三级匹配）与 computeRowCost（分列计费、codex reasoning 不重复计费、未知模型计 0）；estimated 与 reported 永不相加
- ✅ hooks 自动采集（2026-08-08）：`usageplane hooks install` 向 Claude Code settings.json 装 Stop 钩子——每次响应结束触发 `sync --quiet`（hub 已绑定则 sync 自动附带 push）；install 幂等、uninstall 保留他人钩子。VPS 已装。Codex notify 钩子已实现并 Windows 实测（含与 TT 的链式共存，见补课清单）
- ✅ 隐私加固（2026-08-08，回应用户隐私拷问）：会话标题带 `title_source` 溯源——content 衍生（用户首句）的标题**永不出设备**（入库前置空），仅 agent 生成的标题参与 hub 同步；`hub.sync_sessions: false` 可整体关闭会话同步
- ✅ UI 打磨批次一（2026-08-08，响应用户实测审计 P0/P1）：窄屏 56px 顶栏+汉堡+260px 抽屉导航（侧栏不再吃掉小窗口 216px）；页面标题 48/700→34/600；拆掉全站外层大卡（卡套卡模板感），各页独立卡片模块；emoji 图标全部换成统一 Lucide 线性内联 SVG；导航密度对齐上游 13px/32px；窄屏横向溢出修复（热力图/表格卡内滚动）。**审计定性遵循用户方向：不做 TT 外观复刻，保留双设备 hub+中转站资产核心优势，补信息密度与响应式质感**
- ✅ UI 打磨批次二（2026-08-08）：P0.5 移动端三处残余溢出清零（420px 五页 doc==viewport 实测）；P1-4 Tokens 交互深化——表头七列排序、Custom 日期区间（UTC 日界含端点，`/api/usage?range=custom&from&to`）、来源卡点击展开模型明细（token/占比/估算成本）
- ✅ UI 打磨批次三（2026-08-08）：Tokens 项目视图——真页签语义（role=tablist/tab）、八列全排序（SortableHeader 组件：真按钮+键盘+aria-sort，日表复用）、成本按 (project,tool,model) 粒度定价后归并、空项目显式 Unknown 行、短名显示全路径 tooltip；验收实测 Σ项目==范围总计精确相等、420px 无溢出；顺带清 P2 无障碍两项（日期输入 aria-label、来源面板列头标注分母口径）
- ✅ UI 打磨批次四（2026-08-08）：**Skills 管理第一刀**（十条边界全落：详情抽屉本机读 SKILL.md 元数据/远端只显来源；User/Shared 技能按 agent 链接安装（Win junction 免管理员/Unix symlink）；插件缓存严格只读；移除仅删注册表（skill-links.json）内自建链接——真实目录/手工链接/最后一份全部拒绝；目标路径严格限定技能根内且名字只来自磁盘扫描；幂等；成功后重扫+device_state+静默推 hub；Refresh 纯重扫）+ **Limits 增强**（线性节奏预测过窗 10% 后显示、告警阈值 off/70/80/90 红色高亮、Provider 显隐、断连诊断提示）+ Tokens ARIA Tabs 补全（tabpanel/aria-controls/roving tabindex/方向键）。Skills Discover（第三方仓库安装）为第二刀待排
- ✅ Skills 管理安全修复轮（2026-08-08，审计第二轮五项 P1 全清）：①链式链接根除——创建前 realpath 解析到真实目录，注册表存 canonical source，三 Agent 链回归测试②所有权双重验证——路径命中注册表还须解析目标等于登记源，同路径手工替换链接拒删③本地写端点防护——Host 回环白名单（防 DNS rebinding，raw-http 测试）+ 同源 Origin/Sec-Fetch-Site + 强制 JSON④detail 返回 per-agent `install_states`（real/owned-link/foreign-link + removable），抽屉只对可移除项显示按钮⑤测试夹具统一 junction 类型（Unix 忽略/Windows 免管理员），Windows 防护测试不再 EPERM。另修 Limits 剩余模式进度条宽度跟随显示值
- ✅ 加固两项（2026-08-08，审计 P2）：写端点 Origin 严格同源（scheme+host+port 精确等于请求 authority，拒绝 null 与其他回环端口）；链接注册表原子写（tmp+rename）+ 双向回滚（记录失败回滚 junction，删除失败恢复记录）
- ✅ Skills Discover 第二刀（2026-08-08）：移植 TT discover——tree API（main/master 回退）扫 SKILL.md（每仓上限 200）、并发 4 拉 frontmatter、限流友好报错、指纹化 1h 缓存、上游同款四默认仓；安装=下载到 `~/.usageplane/skills/managed/`（temp+原子 rename、逐路径穿越消毒）后经同一 owned-link 注册表链入 agent（所有权/移除规则与手动完全一致）；卸载只删自建链接+托管副本；install 参数以服务端 discovery 数据为准（不信客户端字段）、写端点全部走本地写防护；真实仓库技能 install→双 agent owned-link→uninstall 零残留实测通过。**Discover 待办**：更新检测（blob-SHA 签名已侦察未实现）、自定义仓库源、安装时选 agent
- ✅ Discover 审计修复轮（2026-08-08，第三轮三 P1 + 三 P2 全清）：①安装事务化——任一链接失败或 managed.json 写失败回滚全部本次链接+托管副本（冲突/写失败两条回滚测试）②根构建 npm workspaces 化——`npm install` 装 dashboard 依赖、`npm run build` 同时跑 tsc+Vite，fresh clone/升级不再落旧前端③部分仓库失败显式返回 `{partial, errors[]}`、部分结果只缓存 5 分钟（完整 1h）、Browse 横幅列出失败仓且缓存命中也显示④安装 agent 改服务端固定 allowlist（Claude+Codex），请求只带 key，实测客户端指定 agents 被无视⑤发现并发改全局 4（原每仓 4 峰值 16）、安装下载限额 200 文件/单文件 2MB/总 20MB⑥Skills Tabs 补全 WAI-ARIA（方向键+移焦/aria-controls/tabpanel）
- ✅ Discover 审计第四轮（2026-08-08）：①重装同 key 改 no-op——回滚无法区分本次与既有链接，晚期失败会毁掉先前安装；更新功能待 blob-SHA 签名实现②卸载事务化——注册表先行提交（写失败零改动），磁盘清理失败恢复记录，Browse 的 Installed 永远与现实一致③下载限额流式化——超限 Content-Length 直接拒、逐块累计越过预算立即 cancel，不再先整段入内存④测试 glob 双引号——cmd.exe 下不再 0 tests 假绿⑤故障注入改跨平台 tmp 占位（chmod 在 Windows 是空操作）。**第五轮审计零 P 级、Windows 双 shell 92/92，Discover 第二刀正式关账**（2026-08-08）；校准规则首轮生效——审查方自行对照 TT@main 将唯一发现归为超标建议。其中文案准确性子项按"成本≈0"例外已修（恢复失败时如实报告）；完整文件系统事务与更新/回收站机制一并设计（第三刀）
- ✅ 视觉重构批次（2026-08-08，GitHub 风格校准）：P0 固定应用壳（h-dvh 文档禁滚、220px 侧栏常驻+导航独立滚动、主区唯一滚动区）+ GitHub Primer 令牌换肤（中性色/交互蓝/语义色亮暗两套灌入原 oai-* 类名、6px 圆角、H1 30px、KPI 上限 56px、淡绿画布保留为品牌识别）+ 控件语义化（up-seg/up-btn/up-input，rounded-full 仅限状态标签与真 segmented）；P1 四页——Tokens 12 栅格 4/8+1680 上限+表格卡内滚动 sticky 头、Sessions 1200 上限+品牌图标+32px 终端 Copy 钮、Limits 两列 Provider+进度限宽+已连接优先、Skills Agent 图标矩阵（装=品牌色/未装=淡化，行列对齐）+Browse 3/2/1 等高卡片栅格；ProviderIcon 注册表移植自 TT（MIT，@lobehub mono 内联），三页共用。验收：四档视口×五页 doc==viewport、桌面滚底侧栏不动、暗色完好、92/92
- ✅ 热力图重建（2026-08-08，实测报告三根因全修）：①活跃格透明——组件引用被换肤删除的 bg-brand-200/300，改为上游五档实色（亮暗各一套，永不依赖框架色令牌）②分级从"值/全局最大"改为上游 P50/P75/P90 分位（单峰值不再压扁其他活跃日）③26 周 1fr 自适应改为周日对齐 52×7 UTC 矩阵、12px 格/3px 距、月份+星期标签、Less/More 图例、初载滚至最新、未来日不渲染。纯函数库 activity-heatmap.js 先测后写（6 用例）；四档视口×双主题实测零透明活跃格、仅卡内滚动。**教训入账：视觉令牌重构时必须全库检索被删令牌的引用**
- 后续 UI 批次（审计待排）：语言统一待 i18n 基建
- 后备（本批次未排）：项目归属升级 git-root、Cursor/Gemini 采集器

## v0.5 — 中转站侧对齐批次（当前批次，向 All API Hub 靠；用户定 2026-08-08：先于 v0.3 云端）

批次顺序（用户定）：今日用量/模型统计 → 站点自动识别 → Key 管理与凭证导出 → 价格对比/可用性检测 → 签到 → 更多站点适配。细节见 FEATURE-MAP.md 中转站侧表：

- 🔨 今日用量/按模型统计（2026-08-08 垂直切片完成）：`usage_log` 能力位 + `fetchTodayUsage`（上游双路径：`/api/log/self/stat` 精确总额，回退分页 `/api/log/self` 聚合；本地时区日界秒级时间戳；分页触顶标记 partial；{items,total} 与裸数组两种载荷形态都收）；按模型分组是我们的扩展（同批日志行按 model_name 累加）；sk- key 无法读管理日志 API，明确报错降级。`GET /api/relays/usage`（240s 缓存）+ CLI `relays` 今日行 + 面板中转站卡今日消费/模型排名。真实站点 30 天窗口验证：131 请求/13 模型解析正确。**待与网页后台对拍关账**
- ⬜ 更多站点架构：Veloera / one-hub / Sub2API…（按 relay-sites.md 谱系逐个验证）
- ⬜ 模型价格对比、可用性检测
- ⬜ Key 管理（列出/复制/创建）与凭证导出（CherryStudio / CC Switch）
- ⬜ 站点自动识别（粘贴 URL 判断架构类型）
- ⬜ 自动签到（token 化可行的站先做；纯 cookie 站评估后可能有意不做）

## 补课清单（跨批次悬项，防遗忘）

Windows 实机四连验证已跑（2026-08-08），结果与后续动作：

- ✅ **Codex 对拍验收**：关账（见 v0.2 批次记录）
- ✅ **Codex 限额抓取**：Windows 实测连通，利用率 16%。真实响应暴露了新形态并已补齐：`limit_window_seconds=2628000`（月窗口，标签 30d，未知秒数通用降级为时长标签）、`reset_after_seconds` 倒计时、数字型 `reset_at`（epoch 秒/毫秒自适应）
- ✅ **Codex 钩子**：保护逻辑实测生效（TT 占用 notify 时不覆盖）。因 notify 是单值槽位，新增**链式共存**：`hooks install` 遇外来 notify 改写为 `usageplane notify-chain --then <原命令…>`——先跑我们的 sync，再原样转发 payload 调起原命令；uninstall 把槽位原样归还。**Windows 需重跑一次 `hooks install` 启用链式**
- ✅ **Windows Claude 限额凭证排查**（2026-08-08 定性）：上游侦察确认 TT 的 `readClaudeCodeAccessToken` 在 Windows 读的就是同一个 `~/.claude/.credentials.json`（darwin 才走 Keychain），无第三位置——我们已对齐，无需适配。该机文件确实不存在且凭据管理器无 claude 条目 → 判定该 Windows 的 Claude Code 走 API key/中转站认证（此模式不产生订阅 OAuth，限额窗口对该机本就不存在，"Not connected" 是正确显示）。doctor 增加鉴别提示（检测 env/settings.json 中 ANTHROPIC_* / apiKeyHelper 字段名，永不读值）。合并视图下 Windows 仍可经 pull 看到 VPS 的 Claude 限额

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
| 2026-08-07 | 隐私边界修订（用户定）：会话**元数据**（标题/计数/时长，正文永不）纳入 hub 同步——hub 是用户自己的服务器，跨设备浏览会话列表是核心诉求。官方托管 hub 时代此项必须转 opt-in。新增 `pull` 命令使任何设备可呈现全量视图 |
| 2026-08-08 | **审计校准决策（用户定）**：审计发现须经"真伪复现 + 上游对照"双重验证后再修，上游没有的加固默认"有意不做"。逐项核对结论——真实且上游同修：junction 判定、Windows 测试 glob、workspaces 构建；真实但源于我们的设计分歧（合理修）：realpath 防链式（TT 靠 SSOT 免疫）、自建链接注册表（用户自定边界，TT 直接覆盖目标）；**超出上游标准（保留但不再加码）**：写端点严格同源+Host+Content-Type（TT 只查回环 Origin/Referer）、注册表原子写+安装/卸载事务回滚（TT 普通 writeFileSync 无回滚）、下载流式限额 200 文件/2MB/20MB（TT 无任何限制）、发现全局并发 4（TT 每仓 4 叠加）、partial 显式呈现+短 TTL（TT 静默缓存部分结果）、安装 agent 服务端 allowlist（TT 信任客户端 targets）。规则已写入 CLAUDE.md/AGENTS.md |
| 2026-08-08 | Codex 对拍口径定案：验收只对五个原始分栏，`total_tokens` 按共享公式（分栏和，reasoning 折入 output）双侧重算——Windows 实测证明 TT 存量账本的存储总数与其自身分栏不一致（旧版漂移），不可作为对照物 |
| 2026-08-08 | Codex notify 冲突处理：从"外来 notify 绝不覆盖（跳过安装）"升级为**链式共存**——包装为 `notify-chain --then <原命令>`，两个工具都跑，uninstall 原样归还。"绝不丢弃外来配置"的原则不变，实现从回避改为兼容 |
| 2026-08-08 | device_state 同步语义定案（Windows 实测发现旧键残留后）：状态是**快照**不是流水账——push 只上传本机状态并携带 `state_device`+`state_kinds` 声明，hub 按 (device,kind) 组整体替换（空组也传播删除）；pull 对他机状态以 hub 为权威整体替换，本机状态始终本地权威。此前 push 会把 pull 来的他机旧行回灌 hub（污染放大器），已一并堵住；旧客户端无声明时回退 upsert |
| 2026-08-08 | Skills 扫描重做（Windows 实测暴露 4 处漏扫后侦察上游定案）：junction/symlink 判定、`.agents` 共享根、插件缓存盘点、深度 3 分组全部照搬 TT skills-manager；`.system` 点目录排除与 `~/.skills` 不扫描均为对齐上游的有意行为。设备来源从"本机隐含"改为显式 installs 矩阵——修复"两台设备看同一技能徽章不一致"的误导 |
| 2026-08-08 | 中转站侧无插件可行性结论：AAH 特殊功能九成走站点 HTTP API（含 new-api 家族签到端点 `/api/user/checkin`），CLI/服务端可实现；插件独占的只有登录态自动捕获（我们用粘贴 token 替代）与页面注入（不追）；纯 cookie 站签到降级为 cookie 粘贴/无头浏览器/放弃三级 |
