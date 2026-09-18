# VOICE_POC_IMPLEMENTATION.md —— Voice POC（第一轮）实施报告

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

> 日期：2026-09-18 ｜ 插件：`blast-engineering-ui@0.2.0-voice1` ｜ 语音插件：`dsh-voice-scribe@0.4.9`
> 结论：**DSH Core 零改动；生产流水线零改动；ML 零改动；未新建独立聊天系统；未新建孤立 Session。**
> 运行时事实与方案取舍见 `VOICE_RUNTIME_AUDIT.md`（同目录，含实测原始数据）。

---

## 1. 本轮做了什么（一句话）

在既有 **Case-Centric Engineering Agent Workspace** 上，接入了**语音输入（本地离线识别）**与
**工程结论朗读**，并把语音**绑定到当前 Case / Design Version / Session**：

```
🎙 点击麦克风 → 说话 → dsh-voice-scribe 录音 → host 侧 SenseVoice 本地识别
   → 文本落进"当前会话"的输入框（不自动发送，可改可弃）
   → 高影响语句弹确认闸门（5 m → 5.5 m / Create new design version?）
   → Confirm 才由同一 Harness 会话执行真实工程任务
🔊 朗读结论 → 只播报 最终状态 / 炮孔数 / 总装药量 / review 提示（白名单字段）
🗣 朗读途中开口 → 立即停止朗读并开始识别（speak-to-interrupt，同会话继续）
```

---

## 2. 复用的现成项目（本轮的"用哪个"）

| 能力 | 复用对象 | 版本 | 为什么是它 |
|---|---|---|---|
| **STT** | **`dsh-voice-scribe`**（PensiveFei） | 0.4.9 | 唯一在**本机 Electron 环境真的能识别中文**的现成方案：识别发生在 **DSH host 进程**（sherpa-onnx + SenseVoice int8），不依赖浏览器 Web Speech（本机实测 Web Speech 云端 `network` 失败、on-device 直接崩渲染进程）。peer 仅 `@deepseek-ai/dsh-llm >=0.1.0-rc.6`，本机 Harness 0.1.1-rc.2 满足。零 key、音频不出本机。 |
| **TTS** | **系统 `speechSynthesis`**（= `dsh-talk` 的 `browser` 引擎同一条实现路径） | Electron 43 内置 | 本机实测可用且离线：3 个本地中文音色（Huihui/Kangkang/Yaoyao），实测朗读 5.465 s。`dsh-talk` 的**播放触发链路**在本机 Harness 上不可用（详见审计 §5.2），故只取其引擎路径而不安装它。 |
| **不采用** | `dsh-talk` / `dsh-realtime-voice` / Qwen Audio Agent+ACP | — | 逐条证据见 `VOICE_RUNTIME_AUDIT.md` §5：A 装得上但 STT/TTS 在本机不可用；B 需付费 Realtime 凭据 + 自写 product 层 + 新开会话；C 无对应插件且会新起 Agent。 |

**没有自研任何 ASR 模型 / TTS 模型 / VAD**；语音采集、识别、合成全部来自上述现成实现。

---

## 3. 架构与数据流（零 Core 改动）

```
┌─ DSH Desktop 2.0.3 renderer（http://127.0.0.1:43120）────────────────────────┐
│                                                                             │
│  composer:  [ + ]  Ask about this design…   [ 🎤 scribe ] [ ● Idle  🔊 ] [↑] │
│                                                    │            ▲            │
│   ①点麦克风 / Alt                                   │            │            │
│        │                                           │            │            │
│        ▼                                           │            │            │
│  dsh-voice-scribe(client) ── MediaRecorder ────────┘            │            │
│        │  16 kHz mono float32 PCM (base64)                      │            │
│        ▼                                                        │            │
│  blast-engineering-ui VoicePill ← 状态镜像（"录音中/转写中"）     │            │
│        │  ↓ 草稿（useInput 读 / inputActions.setDraft 写）        │            │
│  ┌─────┴───────────────┐                                        │            │
│  │ 高影响？ 是 → 闸门   │  5 m → 5.5 m / Create new design version?           │
│  │     否 → 直接留在草稿 │   Confirm → inputActions.submit() ──────────────┐  │
│  └─────────────────────┘                                                │  │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                           │
   host 进程（Electron-as-node 24.18.1）                                    │
   ├─ dsh-voice-scribe /voice-input/transcribe → sherpa-onnx SenseVoice      │
   │    模型 $DSH_HOME/voice/sensevoice（228 MB int8，一次下载）             │
   ├─ blast-engineering-ui /blast-engineering-api/voice?task=<id>            │
   │    只读 canonical-result 的 render.{must_state,core_metrics,notices}    │
   └────────────────────────── 同一个 Harness conversation / 同一个 Session ─┘
```

**关键点**：草稿（composer draft）是"语音"与"工程会话"之间**唯一**的交接面。
Voice 不持有自己的会话、不直连任何工程接口；它只在当前会话的输入框里写字，
并且**永不自动发送**（`§12 禁止自动执行高影响工程修改`）。

---

## 4. 语音 UI（Minimal Industrial Intelligence）

| 状态 | `data-voice-state` | 视觉 | 触发 |
|---|---|---|---|
| Idle | `idle` | 灰点 + `Idle` | 空闲 |
| Listening | `listening` | 品牌红点 + `Listening`（镜像 scribe「🎙 录音中…」） | 点麦克风 |
| Transcribing | `transcribing` | 蓝点 + `Transcribing` + 轻量波形 | 停止录音后本地解码中 |
| Processing | `processing` | 蓝点 + `Processing` | 拉取朗读脚本 / 已确认发送 |
| Speaking | `speaking` | 蓝点高亮 + `Speaking` | 正在朗读结论 |
| Interrupted | `interrupted` | 警告点 + `Interrupted` | 朗读途中用户开口 |

- 未使用卡通麦克风、大面积彩色声波、霓虹、全屏渐变；沿用工作区既有的
  `--dsw-alias-*` 令牌（边框、caption、warn/business 状态色），与 7 个案例页签同一套观感。
- Voice 条位于 Case 工作区页头（以及 Agent 页签的 Trace 抽屉顶部），显示
  **当前绑定**：`AGENT_DEMO_1 · 5 m · T20260917_221003_AGENT_DEMO_1_axv0`（§7）。

截图（真实 Desktop renderer，CDP `Page.captureScreenshot`）：
`blast_engineering_ui/docs/screenshots/voice/`

| 需求 | 文件 |
|---|---|
| 麦克风按钮 | `voice_holes_1_idle.png`（输入框右侧 🎤，与我们的 Voice pill 同排） |
| Listening 状态 | `voice_holes_2_listening.png` |
| 实时识别（草稿） | `voice_holes_4_draft.png` |
| Agent Speaking | `voice_speak_2_speaking.png` |
| 打断 | `voice_interrupt_3_interrupted.png` |
| 高影响闸门 + 同屏 Case Workspace | `voice_diameter_5_gate.png`、`voice_diameter_6_gate_before_confirm.png` |
| 确认发送后 | `voice_diameter_7_sent.png` |

---

## 5. 实际测试结果（真实 Desktop 窗口，可复现）

### 5.1 测试装置（诚实说明）

- **被测渲染器**：DSH Desktop 的 Electron 窗口（不是另开 Chrome 页面）。
  驱动方式：`--remote-debugging-port=9223` + CDP（`_voice_probe/voice_poc_test.mjs`）。
- **麦克风输入**：`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`；
  音频由本机 Windows SAPI（Microsoft Huihui，中文）合成 16 kHz/单声道 WAV，使"说话内容"可复现：
  `_voice_probe/fixtures/q1_holes.wav` = *当前方案一共有多少个炮孔*；
  `q2_diameter.wav` = *把井筒直径改成五点五米重新计算*。
- **识别链路是真的**：scribe 真实录音 → host 侧 SenseVoice 真实解码（非桩）。
  真机演示时去掉这两个 flag 重启即可用真实麦克风。

### 5.2 Test 1 ——「当前方案一共有多少个炮孔？」（6/6 PASS）

| 断言 | 结果 |
|---|---|
| 输入框右侧存在 scribe 麦克风按钮 | PASS — `aria-label 语音输入（Alt）` |
| 点击后进入录音 | PASS |
| 状态条镜像 Listening | PASS — `{"strip":"listening","pill":"listening","body":["🎙 录音中…（再按一次结束）"]}` |
| 状态条镜像 Transcribing | PASS — `transcribing` |
| **识别文本进入输入框** | PASS — `当前方案一共有多少个炮孔？当前方案一共有多少？`（假麦克风循环播放导致重复，属测试装置特性） |
| 未被自动发送 | PASS |

截图：`voice_holes_1_idle.png` / `_2_listening.png` / `_3_transcribing.png` / `_4_draft.png`

> "Agent 基于当前案例回答 58" 属于既有能力（项目历史轮次已验证）；本轮新增的是
> **这句话由语音进入输入框**，用户点发送后即为标准 Harness 行为。

### 5.3 Test 2 ——「把井筒直径改成5.5米重新计算。」（7/7 + 确认 3/3 PASS）

| 断言 | 结果 |
|---|---|
| 识别文本进入输入框 | PASS — `…把井筒直径改成5.5米，重新计算，把井筒直径改成。` |
| 未被自动发送 | PASS |
| **高影响确认闸门自动弹出** | PASS — 显示真实差异 **`5 m → 5.5 m`**（取自 canonical `render.core_metrics["井筒设计直径（m）"]`）+ `Create new design version?` |
| 点 **Confirm** | PASS — 闸门关闭、草稿释放（`draft:""`） |
| 消息进入**当前会话** | PASS — 会话新增该条用户消息 |
| Harness 接手并开始真实工程任务 | PASS — 会话随即出现：读取 `.agent_tmp\request.json` → 校验 **5.5 m** 参数通过 → 以 `--parent-task-id T20260917_221003_AGENT_DEMO_1_axv0` 发起 `blast.cmd run-analysis --foreground`（父任务 = 当前 5 m 版本） |
| 高影响操作仍由人把关 | PASS — 该工具调用因需要放宽沙箱（Phase 6 模型加载需 joblib 子进程）而**停在审批**（`等待审批` + 拒绝/允许一次），**没有任何自动放行**。是否放行由工程师在会话里决定（本轮未代点） |

截图：`voice_diameter_1_idle` / `2_listening` / `3_transcribing` / `4_draft` / `5_gate` /
`6_gate_before_confirm` / `7_sent.png`

**同屏可见的 Voice 条（会话内实测文本）**：

```
VOICE   Idle   🔊 朗读结论   停止   🔈 有声   Voice replies OFF
AGENT_DEMO_1 · 5 m · T20260917_221003_AGENT_DEMO_1_axv0
· 语音输入：dsh-voice-scribe（本地 SenseVoice，音频不出本机）   · 已确认发送
```

→ 直接证明 §7 的绑定要求（Project/Case/Design Version/Session 全在当前界面显示）
与 §8 的闸门行为（`已确认发送` 只在点击 Confirm 后出现）。原始抓取见
`_voice_probe/session_tail.json`。

### 5.4 Test 3 —— Agent 完成后朗读（3/3 PASS）

| 断言 | 结果 |
|---|---|
| 点击 🔊 朗读结论 | PASS |
| `speechSynthesis.speaking == true` 且状态条 `speaking` | PASS |

**实际朗读文本（host 生成，逐字来自项目自身计算）**：

```
AGENT_DEMO_1 5 米方案。炮孔总数 58 个，推荐总装药量 141.406 公斤，单位炸药消耗量 1.713 千克每立方米。
掏槽孔 4 个，辅助孔 28 个，周边孔 25 个。最终状态：候选参考—需工程师调整（CANDIDATE_REFERENCE）。
置信度：LOW。工程提示 3 条，首要一条：超出历史数据域：NO_HISTORICAL_RECORD: AGENT_DEMO_1 不在历史证据池
（合成/无记录案例）。需要人工复核后采用。
```

**绝不朗读**（`lib/voice-script.mjs` 白名单 + 自检断言）：Technical Trace / Think / Pwsh / Read / Write、
raw JSON、tool arguments、路径、provenance、token 信息；
自检 `guard.contains_path_like=false`、`contains_raw_json=false`、`within_cap=true`（225 字）。

截图：`voice_speak_1_idle.png` / `_2_speaking.png`

### 5.5 Test 4 —— 朗读途中开口即打断（4/4 PASS）

| 断言 | 结果 |
|---|---|
| 🔊 朗读启动 / 处于 Speaking | PASS |
| **用户开口（打开麦克风）→ 朗读立即停止** | PASS — `speechSynthesis.speaking=false`，状态条切 `listening` |
| 新语句在同一会话继续识别 | PASS |

**不新建 Session**：全程同一个 composer / 同一个 Harness conversation
（会话标题未变：`读取 AGENT_DEMO_1 5.0 m 方案结果 — DeepSeek Harness`）。
截图：`voice_interrupt_1_idle.png` / `_2_speaking.png` / `_3_interrupted.png`

### 5.6 无 LLM 的可重复自检（回归）

| 层 | 命令 | 结果 |
|---|---|---|
| 语音层 + API（新） | `node blast_engineering_ui\tools\voice-selftest.mjs` | **17/17 PASS** |
| 数据层（既有） | `node blast_engineering_ui\tools\selftest.mjs` | 19/19 PASS |
| Host 契约（既有） | `node blast_engineering_ui\tools\host-contract-test.mjs` | 14/14 PASS |

> 测试日志中另有一次 6/7 的记录，是**两个驱动脚本并发**时 Confirm 清空草稿造成的
> 断言竞态（非产品缺陷）；串行重跑为 7/7。

---

## 6. 修改了哪些文件

### 6.1 仓库内（**只动 `blast_engineering_ui/`，其余目录一律未改**）

| 文件 | 变更 | 说明 |
|---|---|---|
| `blast_engineering_ui/lib/voice-script.mjs` | **新增**（~170 行） | 由项目自身 `render.{must_state,core_metrics,engineering_notices}` 组装**朗读脚本**（白名单 + 泄露自检）；纯函数、可单测 |
| `blast_engineering_ui/lib/api.mjs` | +2 路由、+1 import | `GET /voice?task=<id>`（朗读脚本）、`GET /diff?task=<id>&to=<m>`（高影响差异；当前值取自 canonical） |
| `blast_engineering_ui/lib/client.js` | +~330 行（语音层） | CSS（工业风最小集）、`voiceStore` 状态机、`speechSynthesis` 播放器（含 barge-in/静音）、scribe 状态镜像、高影响检测与确认闸门、`VoiceStrip`（Case 页头/Agent 抽屉）、`VoicePill`（输入框右侧）、`apply()` 中注册 `conversation.input.right` 槽位与 conversation 接缝 |
| `blast_engineering_ui/tools/voice-selftest.mjs` | **新增**（17 断言） | 无 LLM 自检：真实数值、禁止项、guard 标志、400/404 |
| `blast_engineering_ui/package.json` | 版本 → `0.2.0-voice1`；`files` 增补 | 描述同步 |
| `blast_engineering_ui/docs/screenshots/voice/*` | **新增**（19 个 png/json） | 本轮证据 |

### 6.2 仓库外（用户层，**不覆盖任何原文件**）

| 位置 | 变更 | 备份 |
|---|---|---|
| `%USERPROFILE%\.dsh\profiles\desktop\package.json` | `dependencies` + `dsh.profile.bundles` 各追加 `dsh-voice-scribe: 0.4.9` | 变更前的 `package.json` 见 §7 回滚脚本（`dsh plugin remove` 自动还原） |
| `%USERPROFILE%\.dsh\profiles\desktop\node_modules\` | 安装 `dsh-voice-scribe`（+ 可选原生依赖 `sherpa-onnx-node` / `sherpa-onnx-win-x64`） | 同样由 `dsh plugin remove` 清理 |
| `%USERPROFILE%\.dsh\voice\hot.txt` | **新增**：立井钻爆热词替换表（掏槽孔/周边孔/装药量…） | 删除即恢复默认（无热词） |
| `%USERPROFILE%\.dsh\voice\sensevoice\` | **新增**：SenseVoice int8 模型（228 MB）+ tokens.txt | 删除即回到"首次使用自动下载" |
| `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` | **未改动**（仍只有上一轮的 `blast-engineering-ui` 一行） | 既有备份 `cordis.patch.yml.bak-blast-ui-phase2` 保留 |

### 6.3 是否修改 DSH Core

**没有。** 证据：

1. `<DSH_INSTALL_DIR>\resources\app.asar`（104,412,135 B）**未被写入**
   （本轮只读扫描：`_voice_probe/asar_scan.cjs` / `asar_lookup.cjs`）。
2. 未注册/覆盖任何官方插件；`dsh-voice-scribe` 作为**第三方 bundle 行**由 profile 组合层加载
   （`dsh plugin add` 写的是**用户 profile**，不是 Core）。
3. `blast-engineering-ui` 依旧只用官方扩展点（`slots` / `locale` / `webServer.register` /
   `webserver/index-inject` / `remote`），**未新注册 conversation node、未覆盖对话渲染**。
4. 本轮**未安装** `dsh-talk` / `dsh-realtime-voice` / `dsh-multi-model-provider`，也未引入任何 MCP。
5. 生产目录（`51_…`/`17_…`/`23_…`/`43_…`/`47_…`/`49_…`/`50_…`/`53_…`/`52_…`/`agent_adapter/`）**零写入**；
   唯一新增写入是插件的自有缓存 `blast_engineering_ui/.cache/`（既有行为）。

---

## 7. 一键回滚

```powershell
# ── 回滚语音插件（STT）────────────────────────────────────────────────────────
# 让 PATH 里带上 DSH 自带的 shim（pnpm/node）
$env:PATH = "$env:APPDATA\DSH Desktop\runtime-commands\bin;$env:APPDATA\DSH Desktop\host-commands\desktop\bin;$env:PATH"
& "$env:APPDATA\DSH Desktop\host-commands\desktop\bin\dsh.cmd" plugin --profile desktop remove dsh-voice-scribe

# ── 回滚语音 UI（朗读 / 状态条 / 闸门）───────────────────────────────────────
# 方式 A（推荐，最小改动）：用上一轮已备份的补丁层恢复，再重启 DSH Desktop
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-blast-ui-phase2" `
          "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Force
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\node_modules\blast-engineering-ui"
cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\blast-engineering-ui"

# 方式 B（只想关掉语音、保留 Case 工作区）：把 client.js 的 voice 注册行注释掉即可，
# 或直接删除以下三类文件/目录后重启：
#   blast_engineering_ui/lib/voice-script.mjs
#   blast_engineering_ui/tools/voice-selftest.mjs
#   （client.js/api.mjs/package.json 见 git diff，可按 hunk 反向应用）

# ── 回滚热词与模型（可选，删掉即回到默认）────────────────────────────────────
Remove-Item "$env:USERPROFILE\.dsh\voice\hot.txt" -Force
Remove-Item "$env:USERPROFILE\.dsh\voice\sensevoice" -Recurse -Force

# ── 最后 ─────────────────────────────────────────────────────────────────────
# 重启 DSH Desktop
```

回滚后：DSH 回到上一轮的 Case-Centric UI（无语音）；仓库内删除 `blast_engineering_ui/`
即彻底消失，**不影响任何生产流水线与既有入口**
（`python 51_one_click_end_to_end/run_one_click_design.py …`、`python 52_gui_v1/app.py` 始终可用）。

### 7.1 正常（非测试）启动方式

```powershell
# 真机麦克风，带调试端口
Start-Process "<DSH_INSTALL_DIR>\DSH Desktop.exe" -ArgumentList '--remote-debugging-port=9223'

# 可复现测试（假麦克风；wav 由 SAPI 合成，见审计 §4.3）
Start-Process "<DSH_INSTALL_DIR>\DSH Desktop.exe" -ArgumentList `
  '--remote-debugging-port=9223','--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  "--use-file-for-fake-audio-capture=D:\...\_voice_probe\fixtures\q1_holes.wav"
```

---

## 8. 工程安全规则（§8）如何落地

| 规则 | 实现 | 证据 |
|---|---|---|
| Voice **不允许直接覆盖正式方案** | Voice 只会写进 composer 草稿；**代码里没有任何自动 `submit()`**（`VoicePill` 只在 Confirm 按钮的 onClick 里调用 `send()`） | Test 1/2 断言 "transcript was NOT auto-submitted" |
| 可以直接创建新计算任务 | "把直径改成 X 米" 被识别为 `new_version`，闸门文案就是 `Create new design version?`，Confirm 后交给当前会话执行 | `voice_diameter_6_gate_before_confirm.png` |
| 覆盖历史版本 / 删除案例 / 替换正式结果 / 修改冻结数据 → **必须文本确认** | 破坏性动词表 `覆盖/删除/替换/作废/废弃/冻结/回滚/恢复原/清空/抹掉` → 闸门类型 `destructive`，文案"这是破坏性操作（X），Voice 不会自动执行" | `lib/client.js` `VOICE_DESTRUCTIVE` + 闸门分支 |
| 确认框内容 = 真实差异 | `` `5 m → 5.5 m` `` 的 `from` 值来自 `GET /diff`（canonical `render.core_metrics`），**不是页面估算**；取不到时显示 `—` 而不是猜 | 自检 `impact diff without canonical yields null (never a guess)` |
| Voice confirmation 不能绕过 UI 确认 | 没有"语音说确认"这个通道；只能点 Confirm 按钮；Cancel 会清空草稿 | 闸门仅有两个按钮，无语音确认入口 |
| 不朗读 Chain-of-Thought | 朗读源是 host 端白名单脚本（`voice-script.mjs`），与对话内容无关；自检断言无路径/无 JSON | §5.4 |

**HOLD 语义**：破坏性或版本变更语句在草稿中时，
`VoiceStrip` 会显示 `Voice` 状态与闸门面板；文本**仍保留在输入框**（可先修改），
只有 Confirm 才写回并发送，Cancel 清空。

---

## 9. 已知限制与下一轮

| # | 限制 | 说明 |
|---|---|---|
| 1 | Listening/Transcribing 是**镜像** scribe 的文案 | 该插件在 DSH 0.1.1-rc.2 上没有结构化状态出口，我们只能监听其状态行（"录音中/转写中"）；**未修改插件本体**。若上游提供事件，可改为订阅 |
| 2 | 无 VAD 自动断句 | 采用"点击开始 / 再点结束"（scribe 的 `hold` 模式亦可 Alt+按住）；按 brief 要求**不自研 VAD** |
| 3 | 朗读文本是"结论摘要" | 按 §4 只播报 最终状态/核心结果/关键 warning/复核要求（225 字）；不做整段回答朗读，避免把 Trace 念出来 |
| 4 | 自动播报（Voice replies ON）用"运行中→空闲"启发式触发 | 手动 🔊 是确定路径；自动模式的触发依赖 composer 的 stop 可用性变化，已在代码注释中标注 |
| 5 | 交叉验收 | 本轮**未**做全双工（实时流式/连续对话），也未安装 `dsh-voice-mode`；按 brief 要求在此暂停 |
| 6 | 升级 Harness 后可回收的能力 | 若 Harness 升到 `>=0.1.2-rc.1`：`dsh-talk`（≥0.3.8）与 `dsh-voice-mode` 都可直接评估，届时可把 TTS 换成插件原生（并保留本地 STT） |

### 下一轮（建议，未执行）

1. **全双工 POC**：评估 `dsh-voice-mode@0.7.7`（本地 zipformer2 流式 ASR + Edge TTS/VITS + 真 barge-in），
   与本轮"点击式 + 最终答案朗读"并存（配置开关切换）。
2. **工程语义层**：把"参数变更"从正则升级为**结构化解析**（复用 `one_click_schema.json` 的字段名），
   使闸门能显示任意参数的 `旧 → 新`（直径/孔距/装药量…）。
3. **语音绑定强化**：把 Voice 条与"当前会话 vs 当前选中 Case"不一致的情况显式提示
   （本轮只显示绑定值，不强制二者一致）。

---

## 10. 交付物清单对照（brief §13）

| 要求 | 位置 |
|---|---|
| `VOICE_RUNTIME_AUDIT.md` | 仓库根（含实测 JSON 与原始日志引用） |
| `VOICE_POC_IMPLEMENTATION.md` | 仓库根（本文件） |
| 1 麦克风按钮截图 | `docs/screenshots/voice/voice_holes_1_idle.png` |
| 2 Listening 状态截图 | `voice_holes_2_listening.png` |
| 3 实时识别截图 | `voice_holes_4_draft.png` |
| 4 Agent Speaking 截图 | `voice_speak_2_speaking.png` |
| 5 Voice + 当前 Case Workspace 同屏 | `voice_diameter_5_gate.png`、`voice_diameter_6_gate_before_confirm.png` |
| 6 实际测试结果 | 本文件 §5（+ 每场景 `*_report.json`） |
| 7 使用的现成 Voice 项目 | `dsh-voice-scribe@0.4.9`（STT）+ 系统 `speechSynthesis`（TTS） |
| 8 对原项目修改了哪些文件 | 本文件 §6.1 / §6.2 |
| 9 是否修改 DSH Core | **否**（§6.3） |
| 10 一键回滚方式 | 本文件 §7 |

### 复现实验（无需 LLM）

```powershell
node blast_engineering_ui\tools\voice-selftest.mjs                      # 17/17
node _voice_probe\voice_poc_test.mjs --scenario=holes                   # Test 1（需 q1 假麦克风）
node _voice_probe\voice_poc_test.mjs --scenario=diameter                # Test 2（需 q2 假麦克风）
node _voice_probe\confirm_send.mjs                                      # Test 2 的"确认发送"
node _voice_probe\voice_poc_test.mjs --scenario=speak                   # Test 3
node _voice_probe\voice_poc_test.mjs --scenario=interrupt               # Test 4
```

> 探针目录 `_voice_probe/` 是**一次性验证工具**（含假麦克风 wav、CDP 驱动、原始 JSON），
> 不属于产品代码；删除它不影响任何功能。



