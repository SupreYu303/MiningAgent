# Conversation-Native UI 重设计（v0.3.0-voicefirst → v0.4.0-conversation-native）

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

本文记录 `blast-engineering-ui` 浏览器半（`lib/client.js`）从**语音优先浮层**改写为
**对话原生三栏工作区**的全部改动：删掉了什么、占用了哪些官方席位、复用了 DSH 的哪些能力、
渲染器清单、语音如何进入 Composer、折叠行为、对 DSH Core 的影响（= 无）与回滚方式。

## 0. 一句话结论

> 旧版把 DSH 的对话**盖住**（全屏浮层 + 语音 Orb + 自绘输入框），新版把 DSH 的对话**当主角**：
> 仍然只有 `sidebar` / `details` 两个官方列被本插件接管（`priority:-1`），其余每一个工程节点都
> 住在官方插件自己声明的**空席位**里（header utilities / composer dock / turnTail / input.right），
> 因此对话、Think 卡、工具卡、审批、输入框、发送键、斜杠菜单、图片、快捷键**全部是 DSH 原生行为**。

## 1. 删除的浮层与旧界面（对照 v0.3.0）

| 旧版（0.3.0-voicefirst） | 新版（0.4.0-conversation-native） | 删除理由 |
|---|---|---|
| `shell.overlay` 全屏浮层（Voice-first 工作区） | **完全没有 overlay**：bundle 里不再出现 `shell.overlay`（契约测试断言） | 浮层会截获中间列的点击/滚动/快捷键；"不要大浮层覆盖 conversation/composer" 是硬要求 |
| 中央 **Agent Stage**（自绘对话 + 自绘输入框 + 自绘"发送"按钮） | 中间列就是**原生 Conversation** | 自绘输入框必须重新实现 IME、附件、斜杠菜单、模型选择、停止、审批……这是重复造轮子且必然落后于官方 |
| 语音 **Orb**（idle/listening/thinking/speaking 主视觉） | 语音降级为**输入模式**：标题栏一枚状态 chip + Composer 内一条 strip | Orb 是"以语音为中心"，而工程场景的主流输入是文字；语音只是一个入口 |
| 左列"7 个固定页签"导航（Overview/Plan/3D/Charge/QC/Report/Agent） | 左列 = **工程上下文**（PROJECT / CASES / DESIGN VERSIONS / THREADS · HISTORY / ARTIFACTS） | 页签导航代替不了"我现在在哪条会话、哪个设计版本上"；且页签会与线程切换打架 |
| 主区页签式 **Plan/3D/Charge/QC/Report 全页** | 右侧 **Preview 列**（AppFrame 的 `details` 席位）原地切换 | 图纸/报告需要在**看着对话的同时**看；切页会丢掉会话上下文 |
| 插件自管的侧栏可见性（`localStorage['blast.ui.sidebar']`） | **交给官方布局服务** `ctx.layout`（`toggleSidebar` / `closeDetails` / `toggleDetails`） | 列的宽度、拖拽把手、窄屏轨道、动画都属于 shell，插件不该另存一份状态 |
| 主区"假进度条 / 重绘结论块"（0.2 轮已开始清理） | 一律用项目自身记录：6 个真实阶段（`STATUS.json` / `AGENT_RESULT.json`）、3 个真实指标（`render.core_metrics`） | 任何非项目计算出来的进度/数值都算编造 |
| 参数变更"直接执行"（0.2 轮） | **变更闸门**：先出结构化差异 + `Cancel` / `Create version`，检测阶段绝不执行 | 工程改动必须显式确认 |

旧版浏览器半保留在 `_stage_probe/client_v0.3.0-voicefirst.js.bak`（回滚用）。

## 2. 席位地图（6 个注册，全部由官方插件声明）

| 席位（slot） | 归属 | 类型 | 本插件组件 | 说明 |
|---|---|---|---|---|
| `sidebar` | ui-layout | single / root | `ContextSidebar` | **接管**（`priority:-1`）：工程上下文；原生侧栏可一键切回 / 切回工程栏 |
| `details` | ui-layout | single / session | `PreviewPane` | **接管**（`priority:-1`）：真实交付物预览（Plane/3D/Charge/QC/Report） |
| `conversation.session.header.utilities` | ui-conversation | list / session | `SessionStatusChip` | 空洞：`AGENT_DEMO_1 · 5.5 m` + 项目自己的 final status / confidence / review 徽章（+ 语音状态） |
| `conversation.composer.dock` | ui-conversation | list / session | `ComposerDock` | 空洞：**参数变更闸门** + **在跑时的工程 Trace** + **运行结束后的「本轮工程记录」卡**（原生 sticky composer stack 内部，不遮挡任何东西） |
| `conversation.chat.turnTail` | ui-conversation | **chain** / session | `TurnEngineeringBlock` | 空洞：在该轮对话末尾追加**工程节点**（差异 / 阶段 / 指标 / 交付物链接） |
| `conversation.input.right` | ui-conversation | list / session | `ComposerVoice` | 空洞：语音状态 + 麦克风 + "把已识别的草稿读回来做变更检测"的桥 |

* `conversation.chat.turnTail` 是 chain，选择器是**纯函数**（`matched` 由 DSH 传入该轮的 turn 属主）；
* **只**有两个 shadow 席位（`sidebar` / `details`），契约测试断言"priority 覆写恰好 2 处"；
* 旧版的 `conversation.composer` chain 席位**已移除**（理由见 §6.1），所以原生审批面板仍占它自己的席位。

## 3. 复用了什么（本插件没有重写的部分）

1. **`@deepseek-ai/dsh-client-ui-layout`**：三栏 AppFrame、列宽拖拽把手、窄屏轨道、`details` 列的开合与让位链、`ctx.layout`（`toggleSidebar` / `toggleDetails` / `closeDetails`）。
   → 本插件的"折叠/展开"按钮只是调用官方服务，列宽与动画全归 shell。
2. **`@deepseek-ai/dsh-client-ui-conversation`**：全部对话渲染（用户气泡 / 助手回答 / Think 折叠卡 / 工具卡 / 审批面板 / 计划审阅 / 重试 / 停止 / 附件 / 图片 / 斜杠菜单 / 模型选择 / 快捷键 / IME），以及 §2 的 4 个席位。
3. **`@deepseek-ai/dsh-client-ui-sidebar`**：`useSessions`（真实会话列表，用于 THREADS · HISTORY 与"切回原生侧栏"）与 `useWorkspaces`（工作区投影）。
4. **`@deepseek-ai/dsh-client-ui-primitives`**：`MarkdownText`（真实 `ONE_CLICK_REPORT.md` 的渲染）。
5. **`dsh-voice-scribe`**：麦克风按钮与语音识别入口（本插件在它已提供按钮时不重复渲染麦克风），识别文本落到**原生 textarea**。
6. **本项目 host 半（`lib/host.mjs` + `lib/api.mjs` + `lib/case-store.mjs`）**：`/manifest` `/version` `/stages` `/activity` `/validate` `/artifact`，数值一律来自项目 CLI 与输出包字节透传。

## 4. 渲染器清单（工程节点 → 数据来源）

| 组件 | 出现位置 | 数据来源（只读，项目自身计算） |
|---|---|---|
| `DiffRows` | 闸门 / 工程记录卡 | 插件在浏览器侧的**检测**结果（见 §5）+ 聚焦版本的 `INPUT.json`（`normalized`） |
| `TraceSteps` | Composer dock（在跑）/ 工程记录卡（完成） | `/stages` → `AGENT_RESULT.json` 的 `stages`；在跑时用 `/activity` → `STATUS.json` 的 `phase/stage/elapsed_s` |
| `MetricTriple` | 工程记录卡 | `canonical.results.render.core_metrics`（炮孔总数 / 推荐总装药量 / 单位炸药消耗量） |
| `StatusChips` | 标题栏 / 轮末记录 | `canonical.status.final`、`canonical.confidence.overall`、`render.must_state.review_required` |
| `ArtifactLinks` | 轮末记录 / 左列 ARTIFACTS | `/version` 的交付物清单（真实文件名，点击只切右侧预览，不跳页） |
| `PreviewFigure` / `PreviewDownloads` / `ChargePreview` / `QcPreview` / `ArtifactPreview` | 右列 Preview | `/artifact?task=<id>&name=<file>` 原字节 + `/validate` 的一致性结论 |
| `ChangeGateBlock` | Composer dock | 检测结果 + 聚焦版本输入 |
| `SessionStatusChip` | 原生标题栏 | `/manifest`（当前案例/版本）+ `/version` |

**首屏禁忌**（验收逐条断言）：不出现绝对路径、Task ID、原始 JSON、token/缓存用量；Think / 工具卡 / stderr 只存在于原生对话里。

## 5. 语音如何进入 Composer（而不是取代 Composer）

```
[麦克风按钮：scribe 自带，或本插件在 input.right 提供的备用] 
        │  本地 SenseVoice 识别（dsh-voice-scribe，音频不出本机）
        ▼
[原生 textarea 里出现识别文本]  ← 本插件从不写草稿，唯一例外见下
        │  ① props.input.draft（输入机状态，首选）
        │  ② 轮询原生 textarea 的 value（冷启动/状态未就绪时的只读兜底）
        ▼
[ComposerVoice 内的一致性检测：识别文本 → 结构化变更]
        ▼
[ComposerDock 弹出 ChangeGateBlock：差异 + Cancel / Create version]
        │  （检测阶段绝不执行任何计算）
        ▼ 点击 Create version（本插件唯一会写草稿的动作）
[把结构化工程指令写回**同一个** Thread 的输入机并提交]
```

* 语音状态（idle/listening/transcribing/error）只在标题栏 chip 与 composer strip 上体现，**不改变页面主题**；
* `Cancel` 只清空草稿与闸门状态，不触碰会话、不改任何项目文件；
* 已确认的指令以 `BLAST 工程指令` 前缀结构化（用户原话 + 变更行 + "父版本请用真实台账确认"），由 DSH 的模型在同一 Thread 内继续，工具调用仍是项目自己的 `blast_engine`。

## 6. 折叠行为与"由 shell 拥有的列"

| 行为 | 触发 | 实现 | 实测（2048×1152，DSH Desktop 2.0.3） |
|---|---|---|---|
| 左列收起为轨道 | 左列底部 `«`（`data-blast-action="sidebar-collapse"`） | 调 `ctx.layout.toggleSidebar()`；DSH 把**桌面外壳**的网格第一列切到 56 px，插件只渲染 shell 给的列 | 280 px → 56 px；轨道内容为本插件渲染（`data-blast-sidebar="rail"`，自身宽度 `56px`，展开按钮 `»`） |
| 左列展开 | 轨道 `»`（`sidebar-expand`） | 同上 | 56 px → 280 px |
| 右列收起 | Preview 头部 `收起`（`preview-close`） | 调官方 `closeDetails()`；本插件不再渲染预览体 | 预览宽 311 px → 0，中间列自动扩宽 |
| 右列重开 | 轮末 / 左列的交付物链接（`data-artifact-link`） | 调官方 `openDetails()` + 切内容（**不跳页**，实测 `location.href` 不变） | 预览 0 → 311 px（图片 2100×1260 真实解码） |

要点：插件**不保存**任何列状态（契约测试断言源码里不再有 `localStorage`）。轨道宽度由插件自己声明
（`56px`），因为桌面外壳可能把列折叠在**外壳层**、而席位仍位于更宽的 surface 内。

### 6.1 为什么变更闸门住在 `conversation.composer.dock` 而不是 `conversation.composer` chain

DSH 的原生审批面板用 `conversation.composer` chain（provider priority 1，本插件原计划 priority 2）。
实测（`_stage_probe/gate_probe.mjs`）发现：**chain 的 `select` 由父级会话的渲染求值**，而本插件的
浏览器 store 无法触发父级重渲染 —— 闸门只会等到"恰好下一次无关重渲染"才出现（有时要等到输入框失焦）。

`conversation.composer.dock` 是**本插件拥有的 list 席位**（原生 stats 行所处的 sticky composer stack），
store 一变就立刻重渲染，因此闸门是**即时**的；它仍然长在原生输入卡片内部的底缘，不遮挡
transcript，也不抢输入框焦点。整个原生审批面板席位因此保持无人占用。

### 6.2 为什么「本轮工程记录」卡也必须在 dock 里（链上副本保留）

同一张卡（`EngineeringCard`）有两个家：

1. **`conversation.chat.turnTail` chain**（DSH 的天然位置：该轮末尾）：注册带纯 `select`，返回
   `{sessionId, turn}`，`matched` 传给组件。**但** chain 的 `select` 是由 DSH 的
   `TurnTailNodeView`（`react.memo`）在**它自己的渲染中**求值的 —— 本插件的 store 变化不会让它重渲染。

   实测证据（`_stage_probe/diag_probe.mjs` + 4 次真实 `--full` 验收）：
   * 每个轮次末尾都渲染出 `data-slot="conversation.chat.turnTail"` 槽位包裹节点，但**内容为空**；
   * 记录本身完全就绪：`data-voice-anchor="10:10:ct"`（maxTurn:resultTurn:change:taskId）、
     `data-voice-match="true"`（用最新轮次调用本插件的 `select` 会命中）、
     状态 chip 已切到新版本 —— 也就是说**匹配成立，只是那次渲染早已过去**；
   * 该 memo 节点在"轮次创建/关闭"之后再无重渲染（实测：连布局服务折叠左栏也不会让它重渲染）。

2. **`conversation.composer.dock`（本插件的席位）**：运行结束（`/activity` 报 `running:false` 且
   `has_package:true`）后渲染**同一张** `EngineeringCard`（`data-blast-result="1"`，带「收起」），
   因此"差异 / 真实阶段判定 / 三个真实指标 / 交付物链接"**保证可见**，且仍然不遮挡对话。

另外，运行期间工程节点**更早**就能挂到那 3 个位置：台账行在运行**开始**时就存在，
`claimRunningTask()` 在 2.5 s 的 `/activity` 轮询里就把该 run 的 `task_id` 认领给对应记录
（并钉住它所属的轮次 `resultTurn`），而不是等运行结束再去对账。

> 结论：**链上副本是"尽力而为"，dock 卡片是"保证可见"**。若未来 DSH 的 chain 语义变成可订阅，
> 只需删掉 dock 里的那一段渲染（`result` 分支），`EngineeringCard` 与链上注册都无需改动。

## 7. 对 DSH Core 的影响：无

* 未修改任何 `@deepseek-ai/*` 文件、未修改 DSH 安装目录、未打补丁；
* 仓库外只有两处**用户层**改动：两个 junction（`~/.dsh/profiles/node_modules/blast-engineering-ui`）与
  一行 profile patch（`profiles/desktop/cordis.patch.yml`，原文件已备份）；
* 插件自身只读项目：唯一写入是 `blast_engineering_ui/.cache/`；
* `ui-theme.preference: dark`（本机 DSH 设置，原为 `system`）：本界面按深色基线设计，
  `#6f9fc4` 冷色强调 + 低对比分隔线；改动已备份为 `~/.dsh/settings.yaml.bak-blast-ui-dark`。

## 8. 回滚

```powershell
# A. 关闭插件行（DSH 回到出厂 UI）
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-blast-ui-phase2" `
          "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Force
# B. 移除包挂载（只删 junction）
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\node_modules\blast-engineering-ui"
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\blast-engineering-ui"
# C. 主题偏好（可选，回到跟随系统）
Copy-Item "$env:USERPROFILE\.dsh\settings.yaml.bak-blast-ui-dark" "$env:USERPROFILE\.dsh\settings.yaml" -Force
# D. 重启 DSH Desktop
```

只回滚**浏览器半**（保留 host 半与插件行）：

```powershell
Copy-Item _stage_probe\client_v0.3.0-voicefirst.js.bak blast_engineering_ui\lib\client.js -Force
# 刷新页面即可（服务端每次请求都从磁盘读 lib/client.js，无需重启 DSH）
```

## 9. 验收与证据

```powershell
# 离线契约（不需要 DSH、不需要 LLM）
node blast_engineering_ui\tools\client-contract-test.mjs      # 34/34
node blast_engineering_ui\tools\selftest.mjs                  # 真实数据层
node blast_engineering_ui\tools\host-contract-test.mjs        # Cordis 装配 + HTTP 契约

# 真机验收（DSH Desktop + CDP，24 项断言 + 8~10 张截图）
node _stage_probe\conversation_native_acceptance.mjs          # 24/24
node _stage_probe\conversation_native_acceptance.mjs --full   # 追加：Create version → 真实流水线（24/24）
```

产物：`_stage_probe/conversation_native_acceptance_report.json`（最近一次运行的完整报告，含每步状态、
`picker` 与 `visibility` 证据）、`blast_engineering_ui/docs/screenshots/conversation-native/01..10_*.png`。

最近一次实测记录（本机 DSH Desktop 2.0.3，2048×1152）：

| 运行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 真机验收（含真实流水线） | `node _stage_probe/conversation_native_acceptance.mjs --full` | **24/24**；`surface=composer dock`，指标 `58 炮孔总数 / 141.406 kg 总装药量 / 1.713 kg/m³ 单位耗药量`，`visibility=visible` | `_stage_probe/native_full9.txt` |
| 真机验收（可重复、不跑算力） | `node _stage_probe/conversation_native_acceptance.mjs` | **21/21**（不含 §8 的三步流水线断言） | `_stage_probe/native_plain_final.txt` |

截图 `01..08` 来自上面那次可重复运行，`09_executing_trace.png` / `10_completed_thread.png` 来自那次
`--full` 运行（同一份最终 bundle）。

验收覆盖的**关键命题**：三栏都在 / 中间列与输入框可点（无 overlay 命中）/ 左列五段都是真实台账行 /
Design Version 切换真实生效 / 输入一句参数变更会在 composer 内弹出结构化差异且**不执行** /
Cancel 清空草稿 / 交付物链接原地切右列且不跳页 / 首屏无路径·Task ID·raw JSON / 麦克风驱动本地识别 /
左列与右列折叠由 shell 完成 / 无席位崩溃。

## 10. 已知限制（诚实清单）

1. **工程记录卡的主位置是 composer dock**（`data-blast-result`），链上（轮末）副本是尽力而为 ——
   原因见 §6.2；同理参数变更闸门也在 dock 卡片内（§6.1）；
2. **没有自定义对话节点类型**：`ConversationNodeDefinition` 需要 **Host 侧产生会话事件**，
   本项目没有引入新的事件生产方，因此工程节点以 `turnTail` chain 的形式挂在**该轮末尾**；
3. **深色是设计要求**：浅色主题下强调色与分隔线对比不足；本机已切 `dark`（可回滚）；
4. **图片预览解码**：右列首帧可能短暂为 0×0（浏览器解码中），验收据此等待而非立即断言；
5. **`--full` 会真实消耗算力**：它真的点 `Create version`、真的跑一次项目流水线（约 1–4 分钟）
   并写入项目台账（这是"一切数值来自项目计算"的必然代价，不是 mock）；
6. **工作区选择器**：DSH Desktop 冷启动可能停在官方"选择一个工作区"主视觉。
   验收脚本会**点击原生控件**（不伪造工作区），并在报告里记录 `picker` 结果；若本机未开过任何会话，
   需要人工选一次工作区后再跑；
7. **改动 `lib/client.js` 会触发 DSH 卸载本插件**（实测 `_stage_probe/hmr_probe.mjs`：bundle 变化后
   15 秒内本插件全部席位消失，且**不会自动重新注册**，页面里也没有异常）。
   因此：**验收/演示进行中不要编辑插件文件**；改完 bundle 需刷新页面（刷新即恢复，实测 4/4 席位）；
8. **页面被遮挡时 Chrome 会冻结定时器**（实测 `_stage_probe/net_probe.mjs`：9 秒零请求、dock 停在
   `running`）。真机验收驱动因此先做 `Emulation.setFocusEmulationEnabled` +
   `Page.setWebLifecycleState('active')`（每个轮询前重复一次），把页面固定为"用户在前台看着"的状态；
   报告里的 `visibility` 字段就是这一步是否生效的证据。
9. **刷新页面后，历史轮的工程记录卡不会重建**：记录（`records` Map）活在页面内存里，台账与输出包才是
   权威数据源；如需历史轮卡片，刷新后重新聚焦该设计版本即可在右列看到同一批真实交付物。

