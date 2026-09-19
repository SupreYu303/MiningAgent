# Phase 2 UI POC（第一轮）交付报告

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

> 方向调整：**不是"美化 DSH Chat UI"，而是 Case-Centric Engineering Agent Workspace。**
> 日期：2026-09-17 ｜ 插件：`blast-engineering-ui` ｜ 结论：**DSH Core 零改动**
> 范围：现有真实案例 `AGENT_DEMO_1` 的 **6.0 m** 与 **5.0 m** 两个真实 Design Version，**无 mock 数据**

---

## 1. 目标与范围

| 需求 | 本轮落实 |
|---|---|
| 保留 DSH Runtime / Session / Conversation / Tool / Skill | ✅ 官方插件全部保留；对话 slot 未被接管，工具卡/审批流/Trace 原样 |
| 通过独立插件扩展 Web Client | ✅ `blast-engineering-ui` 包（Node 半 + 浏览器半），经 DSH 官方 `dsh.client` 双面行机制加载 |
| 左侧升级为 Project / Case / Design Version 浏览器 | ✅ `sidebar` 槽位以更低优先级注册自有组件（官方侧栏仍挂载，可随时回滚） |
| 案例是一级业务对象，点开后固定 7 个页签 | ✅ `Overview / Plan / 3D / Charge / QC / Report / Agent`（工作区声明的 keyed slot + 7 个 keyed renderer） |
| Overview = canonical_result + results.render | ✅ 直接从 `agent_adapter.cli canonical-result` 取 `results.canonical` 与 `results.render` |
| Plan / 3D / Charge 读取真实 Artifacts | ✅ `/artifact` 路由按字节透传输出包内文件（PNG/SVG/PDF/DXF/JSON） |
| QC = 统一 QC + consistency validator | ✅ `ENGINEERING_QC.json` + `validate-result-consistency`（17 项检查）实时结果 |
| Report = 真实报告 | ✅ `ONE_CLICK_REPORT.md` 原文（`MarkdownText` 渲染） |
| Agent 保留 DSH 对话 + Engineering Trace | ✅ 对话在 Agent 页签原位可用；右侧抽屉放真实工程证据 |
| 开发日志不得作为主界面内容 | ✅ Think/Pwsh/Read/Write 等只在**默认折叠**的 Technical Trace 内 |
| 优先使用官方扩展点，能插件化不改 Core | ✅ 见 §5 |

---

## 2. 截图

| 页面 | 文件 |
|---|---|
| **Case Overview**（5.0 m） | `docs/screenshots/shot_case_overview.png` |
| **Plan**（真实 CAD 图纸） | `docs/screenshots/shot_case_plan.png` |
| **Agent**（DSH 对话 + Engineering Trace） | `docs/screenshots/shot_agent_tab.png` |
| 追加：Overview（6.0 m） | `docs/screenshots/shot_case_overview_6m.png` |
| 追加：3D / Charge / QC | `docs/screenshots/shot_case_3d.png`、`shot_case_charge.png`、`shot_case_qc.png` |

截图由无头 Chrome 通过 CDP 驱动真实 UI 生成（`_ui_probe/ui_check.js`），
同一次运行输出 `docs/screenshots/ui_check_report.json`（34 项断言 + 控制台/异常记录）。

---

## 3. 数据来源（逐条，全部来自项目自身计算）

| 界面元素 | 来源 | 实测值（本轮） |
|---|---|---|
| Case / Design Version 列表 | `agent_adapter/workspace/index.json` + `tasks/<id>/STATUS.json`/`INPUT.json` + 真实输出包扫描 | 3 个 case / 14 个版本；`AGENT_DEMO_1` 6 个版本（直径 5、6） |
| Final Status / Confidence / Review Required | `canonical.status.final`、`canonical.confidence.overall`、`canonical.review.required` | 5.0 m `CANDIDATE_REFERENCE` / `LOW` / `true`；6.0 m 同 |
| 必答项 / 核心指标 / 工程警告 / 交付物 | `canonical-result` 信封的 `results.render` | 5 项 must_state、8 项核心指标、3 条 notice、25 个交付物 |
| Plan / 3D / Charge 图与文件 | 输出包 `FINAL_PLAN.png|svg|dxf|pdf`、`FINAL_3D_PREVIEW.png`、`FINAL_3D.dxf`、`CHARGE_STRUCTURE.png|svg|pdf|json` | PNG 实测 2100×1260 / 1540×1260 / 3822×2369 |
| 孔组构成 / 分组装药 | `GEOMETRY_SNAPSHOT.json`、`CHARGE_STRUCTURE.json`（原值表格） | 5.0 m：总孔 58（掏槽 4 / 辅助 28 / 周边 25 / 空孔 1）、总装药 141.406 kg |
| 6.0 m 对照 | 同上（同一 case 的另一个版本） | 总孔 **64**、总装药 **156.184 kg**、q_design 1.713 kg/m³ |
| QC | `ENGINEERING_QC.json`（9 项）+ `validate-result-consistency` | `Checks 17 · Pass 11 · Warn 6 · Fail 0`，warning 逐条展示 |
| Report | 输出包 `ONE_CLICK_REPORT.md` | 2 688 字符原文（渲染后 innerText 约 2 017 字符） |
| Agent 页签工程证据 | task_id / parent / children / canonical 来源 / 证据域 / CBR 邻域 / 输出包路径 | 血缘 `axv0 ← eqb8`，canonical `source=cache|adapter-cli` |

> **数值纪律**：以上数字均由 host 半从项目 CLI 与输出包取得并原样透传；浏览器端没有做任何换算、插值或格式化改写。

---

## 4. 修改文件清单

### 4.1 仓库内新增（全部为**新增**，没有任何既有文件被改写业务内容）

```
blast_engineering_ui/
├─ package.json                        1.1 KB   DSH 双面插件清单（dsh.client / dsh.bundle.patch / exports）
├─ cordis.patch.yml                    0.8 KB   bundle 安装路径用的插入行（本 POC 走 profile patch 层）
├─ lib/host.mjs                        2.8 KB   Node 半（Cordis 插件）：API 路由 + index 注入
├─ lib/case-store.mjs                 21.4 KB   真实数据层：台账扫描 / CLI 调用 / 缓存 / artifact 白名单
├─ lib/api.mjs                         4.3 KB   HTTP 表面：/health /manifest /version /validate /artifact
├─ lib/client.js                      69.3 KB   浏览器 bundle：样式、store、案例浏览器、7 个页签页面
├─ tools/selftest.mjs                  5.1 KB   数据层自测（真实数据）
├─ tools/host-contract-test.mjs        5.3 KB   Cordis 装配 + HTTP 契约自测
├─ tools/serve.mjs                     1.7 KB   独立 API 开发服务器
├─ README.md                          10.1 KB   安装 / 接线 / 回滚 / 扩展点 / 限制
└─ docs/
   ├─ POC_ROUND1.md                            本报告
   └─ screenshots/*.png (7 张) + ui_check_report.json
```

仓库内另有两处**追加性**改动（不影响既有内容）：

| 文件 | 改动 |
|---|---|
| `.gitignore` | 追加 3 行：`_ui_probe/`、`blast_engineering_ui/.cache/`（忽略本轮探针与插件缓存） |
| `_ui_probe/`（新增目录） | 本轮验证工具与证据：`ui_check.js`（真实 UI 断言/截图）、`cdp_shot.js`、`agent_probe.js`、`check_boot.cjs`、`resolve_probe.cjs`、`tasks_summary.js`、asar 只读探针产物等 |

### 4.2 仓库外新增/修改（用户级 DSH 配置，均可一键回滚）

| 对象 | 类型 | 内容 | 备份 |
|---|---|---|---|
| `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` | 修改（用户 patch 层） | 插入 `- insert: [{id: blast-engineering-ui, name: 'blast-engineering-ui'}]` | `cordis.patch.yml.bak-blast-ui-phase2`（原内容 `[]`） |
| `%USERPROFILE%\.dsh\profiles\node_modules\blast-engineering-ui` | 新增（目录联接） | → `<repo>\blast_engineering_ui` | 无（`rmdir` 即删） |
| `%USERPROFILE%\.dsh\profiles\desktop\node_modules\blast-engineering-ui` | 新增（目录联接） | → `<repo>\blast_engineering_ui` | 无（`rmdir` 即删） |
| `blast_engineering_ui/.cache/` | 新增（插件缓存） | canonical / validator 结果缓存 | 可整目录删除 |

`_ui_probe/applog_before_restart.log` 是重启 DSH Desktop 前的日志快照（对照用）。

### 4.3 **未**修改

- DSH 安装目录（`app.asar`、`resources/**`）：只读引用，未写入任何字节；
- DSH 内置 bundle（`@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-client-*`）：未改；
- 项目冻结资产：`51_one_click_end_to_end/**`、`17_/23_/43_/47_/49_/50_/53_/55_`、
  `PREBLAST_EVALUATION_V1*`、`52_gui_v1/**`、`56_/57_`；
- `agent_adapter/**` 的任何代码文件（本轮探针产生的两个临时 JSON 已删除）；
- 既有入口 `run_one_click_design.py` 与 `52_gui_v1/app.py` 的行为与依赖（未改动、未新增依赖）。

---

## 5. 是否触及 DSH Core？

**结论：没有。** 证据与界定：

1. **未写入 DSH 安装目录**：插件全部代码在仓库内；DSH 侧只做了两类*用户层*操作：
   目录联接（新增，不覆盖任何文件）与 `profiles/desktop/cordis.patch.yml`（DSH 文档定义的
   用户 patch 层，"Your patch layer for this dsh profile"）；
2. **组合层可回滚**：删除 patch 数组项（或恢复备份）后，DSH 回到出厂组合，官方 UI 与行为完全恢复；
3. **未替换官方插件**：`ui-sidebar`、`ui-conversation`、`ui-renderer`、`ui-layout`、
   `ui-tool`、`ui-trajectory` 等全部照常挂载；`sidebar` 只是被更低优先级的注册**渲染遮蔽**
   （`ui-slots` 的官方语义：`register at a different priority to shadow it (lowest renders)`），
   官方侧栏组件仍在树上，卸载插件即恢复；
4. **未覆盖对话渲染**：`conversation.chat.node` / `conversation.details.*` 未注册任何条目，
   对话节点、工具卡、审批与 Trace 仍由官方插件渲染。

---

## 6. 验证证据（可复现，无需 LLM）

| 层 | 命令 | 结果 |
|---|---|---|
| 真实数据层 | `node blast_engineering_ui\tools\selftest.mjs` | **19/19 PASS**（台账 3 cases / 14 versions；canonical `canonical_result.v1`；validator 17 checks；artifact 反遍历用例） |
| Host 装配契约 | `node blast_engineering_ui\tools\host-contract-test.mjs` | **14/14 PASS**（`apply()` 在假 ctx 上注册前缀路由；真实 HTTP 上 GET /health、/manifest、/version、/artifact(PNG 86 086 B) 全部 200；未知端点 404） |
| 浏览器 UI（真实 DSH） | `node _ui_probe\ui_check.js --base=http://127.0.0.1:43120 --out=<dir>` | **34/34 PASS**，`console errors 0`、`page exceptions 0` |

UI 断言覆盖（节选，全部在真实页面上断言真实数据）：

```
PASS  case browser lists cases — 3 cases
PASS  design versions listed for the focus case — 6 versions
PASS  header shows the real case id — AGENT_DEMO_1· 5 m· T20260917_221003_AGENT_DEMO_1_axv0
PASS  no slot-outlet errors anywhere
PASS  sidebar slot is ours (official sidebar shadowed)
PASS  Overview: must-state block from results.render — 5 cells
PASS  Overview: core metrics rendered — 8 metrics
PASS  Overview: status wording gate held (no fake approval)
PASS  Plan: FINAL_PLAN.png served from the real artifact route — 2100x1260
PASS  3D: preview figure loaded — 1540x1260 ; QC 表 26 行
PASS  Charge: CHARGE_STRUCTURE.png loaded — 3822x2369 ; 分组 4 组 ; 总量平衡行
PASS  QC: consistency validator ran — Checks 17 · Pass 11 · Warn 6 · Fail 0
PASS  Report: real ONE_CLICK_REPORT.md rendered — 2017 chars
PASS  Agent: DSH conversation slot still mounted / trace drawer rendered
PASS  Agent: Technical Trace 默认折叠（正文中无开发日志），展开后出现日志与原始 JSON，收起后再次消失
PASS  Design Version switch: 6.0 m 选中并渲染（156.184 kg / 64 孔）
```

端到端加载证明（`curl http://127.0.0.1:43120/`）：
浏览器 roster 从 44 → **45** 条，新增
`{"id":"blast-engineering-ui","url":"/plugins/blast-engineering-ui/client.js?rev=…"}`，
并注入 `__BLAST_ENGINEERING_API__ = http://127.0.0.1:43120/blast-engineering-api`。

---

## 7. 使用方式

1. 启动（或重启）**DSH Desktop**，把工作区设为本仓库；
2. 打开 Harness 页面（本机 http://127.0.0.1:43120/）：左侧即为案例浏览器，默认选中
   `AGENT_DEMO_1` 的最新 Design Version；点 `6 m` / `5 m` 行切换版本；
3. 主区 7 个固定页签：`Overview / Plan / 3D / Charge / QC / Report / Agent`；
   进入 `Agent` 后主区交还 DSH 对话，右侧抽屉给出 Engineering Trace，用左列页签列表返回其它页签；
4. 需要刷新数据：左列底部「刷新台账」；canonical 缓存过期或需重算：Agent 抽屉「重新计算 canonical」；
   QC 页「重新校验」强制执行 `validate-result-consistency`。

---

## 8. 已知限制与下一轮建议

| # | 限制 | 下一轮建议 |
|---|---|---|
| 1 | Agent 页签不接管对话流：工程结论仍在抽屉而非对话内 | 引入 Host 侧会话事件生产方，再用 `ConversationNodeDefinition` + keyed `conversation.chat.node` 注册"工程结论卡"，让结论进入对话流（本轮已探明 API：`ChatNodeDataMap` 声明合并 + `ctx.conversationEvents` 注册 + `conversation.chat.node` keyed renderer） |
| 2 | 主区覆盖依赖对 shell 网格的测量 | 若官方同意，可上游提出"中心列 slot"扩展点提案，替代测量式定位 |
| 3 | 只做了只读查看，没有"从 UI 触发一次真实计算" | 增加 `run-analysis --background` + `task-status` 轮询的 UI 入口（复用 `agent_adapter` 既有命令），并把新版本自动挂到 Case 下 |
| 4 | 版本对比（6.0 vs 5.0）未做 | 复用 `compare-results` 的 `canonical_diff`，在主区加 Compare 页签 |
| 5 | 缓存 TTL 与失效策略简单 | 以输出包 mtime 作为失效依据，取代固定 TTL |
| 6 | 工程数值审计依赖人工看 | 把 `.cache/` 中的 canonical 快照纳入 QC 页的"数据血统"视图（字段级 provenance 已在 canonical 内） |
