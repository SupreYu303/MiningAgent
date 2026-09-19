# LIVE_VOICE_INTEGRATION.md —— 从 POC 到正式 BLAST Studio 的集成设计

> 日期：2026-09-19 ｜ 结论：**复用已验证实现，最小 diff 合入；不重写、不新增页面、不改 Core。**

## 1. 起点与终点

| | POC（已人工验收） | 正式集成后 |
|---|---|---|
| 入口 | 独立页面 `http://127.0.0.1:3080/` | **BLAST Studio 本身**（Composer 右侧 📞） |
| profile | `blast-live-poc-qwen`（home `.dsh-live-poc`） | 正式 `desktop` profile（home `.dsh`，preset `blast-demo`） |
| 会话 | 独立的闸门会话（preset `blast-live-gate`） | **同一个 BLAST Studio 会话**（同一个 Case / Design Version / Preview） |
| 闸门 UI | 独立的闸门页（gate-page.html） | **对话内**：ComposerDock 的 Parameter Diff + `[取消] [创建版本]` |
| 状态显示 | 页面自己的状态条 | Composer 旁的轻量状态（正在连接… / ● 正在聆听 / BLAST Studio 正在回应） |
| 单次语音 | `dsh-voice-scribe`（本地 SenseVoice） | **完全保留**，作为 fallback；Qwen Live 不可用时 Studio 照常用 |

## 2. 从 POC 迁移的**最小部分**（逐项）

| # | 迁移什么 | 怎么迁移 | 有没有改语义 |
|---|---|---|---|
| 1 | realtime voice provider | 把 POC 审计过的 `@harness-remote/dsh-realtime-voice@0.1.0-alpha.9` 以 junction + profile patch 行装进正式 profile（同一份 tgz 解包结果） | 无（第三方包零改动） |
| 2 | protocol bridge（`dsh.voice.v1`） | 由该 provider 自己承担，不迁移代码 | 无 |
| 3 | credential lookup | 由 provider 的 `ctx.credentials.resolve()` 承担；本包不碰 key | 无 |
| 4 | browser-side Live control | 直接用 provider 的 `conversation.input.right` 控件（📞）；本包只在同座位加**只读**相位显示 | 无（未改 provider 客户端） |
| 5 | barge-in lifecycle | provider 自己的本地起音停播 + 云端 VAD + `playback-clear`；本包只镜像相位 | 无 |
| 6 | engineering handoff | 复用 POC 的三件套：`blast_live_gate_request` / `blast_live_design_read` / `blast_live_gate_status`（同一份 `agent-tools.mjs`，挂到 `blast-demo` preset） | 无（工具语义、参数枚举、拒绝理由逐字保留） |
| 7 | gate bridge | 复用 POC 的闸门状态机 / 设计读取 / adapter 调用（同一份 `gate.mjs` / `design.mjs` / `adapter.mjs`），host 面去掉“预绑定入口 + 闸门页” | **只加**人在环许可（见 §4） |

**没有搬的**：`entry.mjs`（POC 的浏览器入口预绑定，Studio 不需要）、`gate-page.html`
（改由对话内渲染）、`blast-live-gate` preset（语音与文字共用同一个 Studio 会话）。

## 3. 语音路径的形状（正式集成后）

```
用户对麦克风说「把井筒直径改成 6 米」
  │
  ├─ Qwen Audio Realtime Plus（provider）负责：连续对话、打断、普通问答
  │
  └─ 工程意图 → handoff_to_dsh_agent → 当前 BLAST Studio 会话的一轮
        │
        ├─ agent 调 blast_live_gate_request（唯一允许的工程动作：开闸门）
        │     └─ host 面 /gate/request ← 旧值来自 canonical-result 的真实输入
        │           gate.json: status=pending, task_id=null
        │
        └─ 对话里出现 Parameter Diff：shaft_diameter_m 5.5 m → 6 m  [取消] [创建版本]
              │
              └─ 人点【创建版本】 → host 面 /gate/confirm（**唯一执行入口**）
                    ├─ 写人在环许可 permit（15 min，绑定 parameter + to + parentTaskId）
                    └─ 起真实 run-analysis → 新 Design Version → Trace / Preview 自动更新
```

普通咨询（“读一下当前设计”“刚才那版怎么样”）不经过任何闸门；
`blast_live_design_read` 只回真实读数，模型不许估算。

## 4. 硬保证：确认之前不执行

三道彼此独立的口子，任何一道都能单独挡住“模型替用户改方案”：

1. **会话面**：`blast-demo` preset 的 Live 行只有“读设计 / 开闸门 / 看闸门状态”三个工具；
   工程执行面（`blast_engine`）背后的 `run_analysis` 被下面的互锁管住。
2. **工具面（fail-closed 互锁）**：Live 通话活跃时（`runtime/voice.json` 的上报新鲜度 < 45 s），
   `blast_engine.run_analysis` 必须持有人工确认的 permit，且必须与请求的实际差异逐字一致
   （parameter + to + parentTaskId；差异由**父版本真实输入**现算，>`1` 处差异一律拒绝）。
   没有通话时（纯文字路径）行为与集成前完全一致。
3. **状态面**：闸门 pending 时 `task_id` 为空；`/gate/confirm` 是唯一执行入口；
   `/permit/check` 只读校验。验收脚本对这三条都有断言。

## 4.1 Live Transcript（字幕层）—— 只读镜像 + 一次诚实的写回

| 关注点 | 做法 |
|---|---|
| 文本来源 | provider 自己的通话卡片（本插件用 CSS 把它收起，但组件仍在渲染）：`[aria-label="实时语音通话"] [class*="userText"\|"assistantText"]`——只读，provider 零改动 |
| 相位来源 | provider 自己的通话控件（通话中自称「结束实时语音」）+ 其相位元素 `data-phase` |
| 显示 | Composer 那一行的**单行省略**字幕：`🎙 用户当前语音` / `🔊 Agent 当前语音`；没有面板、没有 Orb、没有新页面 |
| final 判定 | provider 离开 `listening` 相位的那一刻，最后读到的用户文本即该句最终转写（空文本 / 与上一句重复不算） |
| 写入会话 | 走**原生 Composer** 的 draft + submit（与手打完全同一条路），因此它在对话里就是一条普通 User Message |
| 不重复 | 若 provider 已为该句做 handoff（其 user message 带 `<spoken_input>` 原文），检测到回合数已增加就**跳过**写入 |
| 审计 | `runtime/transcripts.jsonl`：`{text, submitted, reason}`——只有文本与结果，**没有**任何工程动作 |
| 执行权限 | **无**：字幕路径里没有 `/gate/request`、没有 `run_analysis`、没有 `blast_engine`（`client-contract-test.mjs` 有负向断言）；工程侧仍停在 Parameter Diff + 人工【创建版本】，且 Live 通话中 `run_analysis` 仍受 permit 互锁 |

**为什么需要"跳过重复"这一条**：provider 的 handoff 消息里本来就带用户原话
（`<realtime_delegation>…<spoken_input>原文</spoken_input>`），所以工程类话语在会话里
**已经**留下用户原话；再写一遍会变成两条用户消息、并可能开出两张闸门。检测方式是按会话回合数：
最终转写后 2.5 s 内若已出现新回合，就认为 provider 已经记录过这句。

## 5. 冷启动修复（POC 的 process / display / profile id 混用教训）

* `blast_live_voice/lib/studio.mjs` 是 **profile id / preset id / 端口 / 全部路径的唯一来源**；
* `scripts/deploy-studio-live.mjs`、`scripts/start-studio.ps1`、`blast_engineering_ui/tools/install-demo-profile.mjs`
  都从它读，脚本里**不再出现**任何手写的 profile 名；
* `start-studio.ps1` 打印它实际使用的 profile / preset / home / port；
* 真实 Windows 冷启动（杀进程 → 启动 → 等就绪 → 自检）已跑通，见验收文档 §2。

## 6. 为什么不把闸门页也搬过来

用户明确要求：**不新增 Voice 页面、不新增 Dashboard、不出现大 Voice Orb**。
所以闸门改由 ComposerDock 渲染（它本来就是“参数变更闸门”的座位），
provider 的展开浮层被 CSS 收起，只保留它的小悬浮球。

## 7. 没动的东西（对照纪律）

DSH Core、`app.asar`、`OneClickPipeline`、工程算法、Canonical Result Contract、
`51_/17_/23_/43_/47_/49_/50_/53/52_/55_/PREBLAST_*` 全部零改动；
BLAST Studio 的三栏结构、BS 字标、Branding、Conversation-Native UI、Preview 也零改动
（只在两个既有座位里加了内容，没有新增座位）。
