# blast-engineering-ui —— Conversation-native Engineering Workspace

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

DSH（DeepSeek Harness）**客户端插件**：把 Chat UI 升级为以「工程案例」为中心的工作区。
保留 DSH 的 Runtime / Session / Conversation / Tool / Skill 全部底层能力，只通过官方扩展点
新增一层业务界面——**不修改任何 DSH Core 文件**。

版本：**0.4.0-conversation-native**（第三轮：对话原生三栏工作区，取代第二轮的浮层版）

| 文档 | 内容 |
|---|---|
| `docs/CONVERSATION_NATIVE_UI_REDESIGN.md` | **本轮交付**：删掉的浮层、6 个官方席位、复用点、渲染器清单、语音进 Composer、折叠行为、DSH Core 影响=无、回滚、验收证据、已知限制 |
| `docs/VOICE_FIRST_WORKSPACE_POC.md` | 第二轮（Voice-first 浮层版；布局已被本轮取代，语音/数据纪律仍有效） |
| `docs/DEMO_PROFILE.md` | 本机 DSH 2.0.3 permission/approval 机制的源码级结论 + 最小权限 Demo Profile（安装/回滚/自检） |
| `docs/POC_ROUND1.md` | 第一轮（Case-Centric 页签版）交付报告 |
| `docs/VOICE_POC_IMPLEMENTATION.md` / 仓库根 `VOICE_RUNTIME_AUDIT.md` | 第一轮语音 POC 与运行时审计 |

## 三栏结构（第三轮：对话原生）

```
┌ Context Sidebar ─────┬─ DSH 原生 Conversation（主角）────────┬─ Preview Pane ─┐
│ PROJECT              │ 用户气泡 / 助手回答 / Think 折叠卡 /   │ 报告           │
│ CASES                │ 工具卡 / 审批 / 计划审阅 —— 全部官方   │ 平面图         │
│ DESIGN VERSIONS      │ 插件渲染；本插件只在该轮末尾追加工程   │ 3D / 装药结构  │
│ THREADS / HISTORY    │ 节点（差异 / 阶段 / 指标 / 交付物）    │ 工程QC（原地切）│
│ ARTIFACTS            │ ↓ 原生 Composer：文字 + 语音 + 闸门    │                │
└──────────────────────┴────────────────────────────────────────┴────────────────┘
```

* **没有任何浮层**：中间列与输入框就是 DSH 自己的；本插件不注册 `shell.overlay`；
* 参数变更不立即执行：先出结构化差异（`shaft_diameter_m 5 m → 5.5 m`）再 `Cancel` / `Create version`；
* Think / Pwsh / Read / Write / raw stderr 只存在于原生对话自己的折叠卡里（本插件不读不画）；
* 第一屏不含绝对路径 / Task ID / raw JSON / token 数据；
* 左列与右列的**折叠、拖拽、宽度**全部由官方布局服务完成（插件不保存列状态）。

本插件的全部数据来自项目真实台账（`AGENT_DEMO_1` 等真实案例的真实 Design Version），**没有任何 mock**。

![Conversation-native workspace](../docs/assets/01-workspace-overview.png)

---

## 1. 界面结构（7 个官方席位，2 个接管）

| 席位 | 归属插件 | 本插件渲染 | 内容 |
|---|---|---|---|
| `sidebar`（**接管**，`priority:-1`） | ui-layout | `ContextSidebar` | PROJECT / CASES / DESIGN VERSIONS / THREADS · HISTORY / ARTIFACTS（全部真实台账行）+ 折叠成 56 px 轨道 |
| `details`（**接管**，`priority:-1`） | ui-layout | `PreviewPane` | 真实交付物：报告（`MarkdownText`）/ 平面图 / 3D / 装药结构 / 工程QC，原地切换、可下载、不跳页 |
| `conversation.session.header.utilities` | ui-conversation | `SessionStatusChip` | `AGENT_DEMO_1 · 5.5 m` + 项目自己的 final status / confidence / review 徽章 |
| `conversation.composer.dock` | ui-conversation | `ComposerDock` | 参数变更闸门（差异 + `Cancel` / `Create version`）、在跑时的 6 步工程 Trace、运行结束后的「本轮工程记录」卡（真实阶段判定 + 3 个真实指标 + 交付物链接） |
| `conversation.chat.turnTail` | ui-conversation | `TurnEngineeringBlock` | 同一张工程记录卡的链上副本（该轮末尾；见文档 §6.2 的实测限制） |
| `conversation.input.right` | ui-conversation | `ComposerVoice` | 语音状态、麦克风、（只读的）草稿回读桥 |
| `conversation.hero.brand.mark`（`priority:-1`） | ui-conversation | `HeroBrandMark` | 首页 hero 的 BS 交互动画字标（默认蓝灰极简 / hover 轻提亮+一次扫光 / click 从 B/S 交汇点扩散双层脉冲）；该席位由官方声明、部署包占着 priority 0，本插件以更低优先级遮蔽 |


中间列的**对话、Think 折叠卡、工具卡、审批、计划审阅、输入框、发送键、附件、斜杠菜单、快捷键**
全部由官方插件渲染；本插件的**全部注册只有上面 7 个席位**（契约测试断言：没有第 8 个、没有 `shell.overlay`）。
其中第 7 个（hero 品牌标）只做展示：默认态无背景圆、无常驻 glow、无 idle 动画，
hover 只做轻提亮 + 一次扫光（绝不出现圆圈/halo），click 为一次性 900 ms 脉冲后回到默认，
并保留 `prefers-reduced-motion`；它的盒子在布局上占 34 px 宽、0 px 高，
因此首页标题、说明行与 Composer 的几何与官方原状**逐像素一致**（真机实测）。

---

## 2. 架构

```
blast_engineering_ui/            ← 一个 DSH「双面（dual-face）」插件包
├─ package.json                  ← dsh.client{platform:web} + exports["./client"] + dsh.bundle.patch
├─ cordis.patch.yml              ← 作为 bundle 安装时插入的行（本 POC 走 profile patch 层，见 §4）
├─ lib/host.mjs                  ← Node 侧（Cordis 插件）：注册 API 路由 + 注入 index
├─ lib/case-store.mjs            ← 真实数据层：扫任务台账、调项目 CLI、读输出包（纯 Node，可单测）
├─ lib/api.mjs                   ← HTTP 表面（manifest / version / validate / artifact）
├─ lib/client.js                 ← 浏览器侧 bundle（手写 lazy-CJS factory，无需打包步骤）
├─ tools/{selftest,host-contract-test,serve}.mjs
└─ docs/                         ← POC 报告与截图
```

**数据纪律（与项目 `agent_adapter` 一致）**

1. 插件对项目**只读**：不写 `51_one_click_end_to_end/**`、`agent_adapter/workspace/**` 或任何 phase 目录；
   唯一的写入是自己的缓存 `blast_engineering_ui/.cache/`；
2. 一切工程数值都来自**项目自身的计算入口**：
   * `python -m agent_adapter.cli canonical-result`（canonical result + 确定性展示块 `results.render`）
   * `python -m agent_adapter.cli validate-result-consistency`（一致性校验）
   * 真实输出包文件按字节透传（`/artifact?task=<id>&name=<file>`，只允许包目录内的裸文件名）
3. 浏览器端**不做任何计算**：只渲染 host 返回的字段。

---

## 3. 使用的 DSH 官方扩展点

| 扩展点 | 用途 | 位置 |
|---|---|---|
| `dsh.client` 双面行（`@deepseek-ai/dsh-client-modules`） | 同一个包既是 Node 宿主行，又把 `lib/client.js` 送进浏览器 roster（`/plugins/<id>/client.js`） | `package.json` |
| `ctx.webServer.register`（`dsh-host-webserver`） | 注册 `prefix /blast-engineering-api` 路由 | `lib/host.mjs` |
| `webserver/index-inject` 结构化注入行 | 把 `__BLAST_ENGINEERING_API__` / `__BLAST_ENGINEERING_CONTEXT__` 发给页面 | `lib/host.mjs` |
| `ctx.slots.inject` + `ctx.slots.register`（`dsh-client-ui-slots` / `ui-renderer`） | 注册进 `sidebar` / `shell.overlay` / 自有 keyed slot | `lib/client.js` |
| **优先级遮蔽（single slot）** | `sidebar` 槽位以 `priority: -1` 注册，官方 `ui-sidebar` 仍挂载但不再渲染 → 左列升级为案例浏览器，移除插件即恢复原样 | `apply()` |
| `shell.overlay`（list, root） | 主区案例工作区（测量中心列网格宽，覆盖在 conversation 之上；Agent 页签时让位，露出真实对话） | `CaseWorkspace` |
| **keyed renderer / 子槽声明** | 工作区声明子槽 `blast.case.tab`（`kind: "keyed", scope: "root"`），7 个固定页签各自注册一个 keyed renderer | `PAGES` |
| `ctx.locale.register` | 字典命名空间 `blast`（`t` 席位可用） | `apply()` |
| `@deepseek-ai/dsh-client-ui-primitives` | `MarkdownText`（真实报告渲染）、`DisclosureRow`（详细层 / Technical Trace 折叠） | 各页面组件 |
| **未使用：`ConversationNodeDefinition` / `ChatNodeDataMap`** | 新增会话节点种类需要在 **Host 侧产生会话事件**（客户端 fold 之外的生产方）。第一轮不新增节点类型，工程证据走自有 keyed 页面 + API，因此**没有**注册 node definition；`conversation.chat.node` 也未做任何覆盖 | 见 §6 限制 |

> 一句话：**DSH Core 零改动**。新增的只是一个 bundle 行 + 一个用户层 profile patch（可一键回滚）。

---

## 4. 安装 / 接线 / 回滚

### 4.1 本机 POC 的实际接线（仓库外两处，均已备份）

```powershell
# 1) 让裸包名可从 profile 配置目录解析（DSH loader 的解析锚点 ctx.baseUrl）
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\node_modules\blast-engineering-ui"        "<repo>\blast_engineering_ui"
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\blast-engineering-ui" "<repo>\blast_engineering_ui"

# 2) 在 desktop profile 的用户 patch 层插入一行
#    %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
#    （原文件已备份为 cordis.patch.yml.bak-blast-ui-phase2）
- insert:
    - id: blast-engineering-ui
      name: 'blast-engineering-ui'
```

> profile 组合在 DSH（Desktop）启动时读取，因此改动 patch 后需**重启 DSH Desktop**；
> 客户端 bundle 的改动**不需要**重启（服务端每次请求都从磁盘读 `lib/client.js`，刷新页面即可）。

### 4.2 回滚（三步，任一步都能单独关闭插件）

```powershell
# A. 关闭插件行
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-blast-ui-phase2" `
          "%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml" -Force
# B. 移除包挂载（只删联接，不动仓库文件）
cmd /c rmdir "%USERPROFILE%\.dsh\profiles\node_modules\blast-engineering-ui"
cmd /c rmdir "%USERPROFILE%\.dsh\profiles\desktop\node_modules\blast-engineering-ui"
# C. 重启 DSH Desktop
```

回滚后 DSH 完全回到出厂 UI；仓库内新增文件可整体删除，**不影响任何生产流水线与既有入口**。

---

## 5. 验证工具（不需要 LLM，可重复执行）

```powershell
# 真实数据层（任务台账 → 项目 CLI → 输出包）
node blast_engineering_ui\tools\selftest.mjs              # 19/19 通过

# Host 侧 Cordis 装配契约（假 ctx + 真 HTTP handler + 真数据）
node blast_engineering_ui\tools\host-contract-test.mjs    # 17/17 通过

# 浏览器半的席位/浮层/渲染契约（离线，不需要 DSH 与 LLM）
node blast_engineering_ui\tools\client-contract-test.mjs  # 34/34 通过

# 真机验收（需要 DSH Desktop 已在 9223 打开 CDP；24 项断言 + 截图）
# 注：该验收脚本位于内部 _stage_probe/ 目录，未随公开源码版发布
node _stage_probe\conversation_native_acceptance.mjs
node _stage_probe\conversation_native_acceptance.mjs --full   # 追加一次真实流水线

# 只跑 API（不接 DSH，便于 curl 调试；需要项目真实台账目录存在）
node blast_engineering_ui\tools\serve.mjs --port 4180
```

---

## 6. 已知限制

第三轮（对话原生）的完整限制清单见 `docs/CONVERSATION_NATIVE_UI_REDESIGN.md` §10，要点：

1. **变更闸门在 composer 卡片底缘（`conversation.composer.dock`）** 而非输入框上方：
   chain 的 `select` 由父级会话渲染求值，插件的 store 无法触发父级重渲染（实测：闸门会延迟到下一次无关重渲染）；
2. **没有自定义对话节点类型**：`ConversationNodeDefinition` 需要 Host 侧产生会话事件，
   本项目没有引入新的事件生产方，因此工程节点挂在 `turnTail` chain（该轮末尾）；
3. **深色是设计要求**：本机 DSH 的 `ui-theme.preference` 已从 `system` 改为 `dark`（备份可回滚）；
4. **`--full` 会真实跑一次项目流水线**（约 1–4 分钟），因为一切数值必须来自项目自身计算；
5. **冷启动可能停在官方"选择一个工作区"主视觉**：验收脚本点击原生控件，失败时需人工选一次；
6. **canonical 计算成本**：每个版本首次打开调用一次项目 CLI（实测 0.9–1.8 s），随后命中缓存
   （TTL 5 分钟；缓存位于 `blast_engineering_ui/.cache/`）；
7. **roster `inject` 只用于排序**：浏览器 roster 的 `inject` 是 DSH 的插件顺序声明，不构成服务等待；
   真正的服务依赖由插件导出的 `inject = ["slots","locale"]` 承担（`layout` / `sessions` / `workspaces` /
   `conversation` 服务在 `apply` 内用 `ctx.inject([...])` **可选**取得，拿不到就退化为只读空值）。

---

## 7. 目录速查

| 路径 | 说明 |
|---|---|
| `lib/host.mjs` | Node 半：`inject = ['webServer']`，注册 `/blast-engineering-api` 前缀路由 |
| `lib/case-store.mjs` | 任务台账扫描、`package_dir` 解析、CLI 调用、缓存、artifact 白名单 |
| `lib/api.mjs` | `/health` `/manifest` `/version` `/stages` `/activity` `/validate` `/artifact` |
| `lib/client.js` | 浏览器 bundle（**本文件就是产物，无打包步骤**）：6 个官方席位、store、工程渲染器、语音桥、CSS 注入 |
| `tools/selftest.mjs` | 数据层自测（真实数据） |
| `tools/host-contract-test.mjs` | Cordis 装配 + HTTP 契约自测 |
| `tools/client-contract-test.mjs` | 浏览器半的席位/浮层/渲染契约（离线，解析 bundle 的注册） |
| `tools/serve.mjs` | 独立 API 开发服务器 |
| `docs/CONVERSATION_NATIVE_UI_REDESIGN.md` | **第三轮交付报告**（席位地图、复用点、回滚、验收、限制） |
| `docs/POC_ROUND1.md` / `docs/VOICE_FIRST_WORKSPACE_POC.md` | 第一/二轮交付报告（历史） |
| `../docs/assets/` | 公开版精选真机截图（5 张 + 品牌图） |
| `docs/screenshots/` | 第一/二轮内部图集（未随公开版发布） |


