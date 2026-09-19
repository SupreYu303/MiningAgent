# VOICE_FIRST_WORKSPACE_POC.md —— Voice-first Case-Centric Engineering Agent Workspace（第二轮）

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

> **已被取代**：第三轮把浏览器半改写为「对话原生三栏工作区」（`blast-engineering-ui@0.4.0-conversation-native`，
> 见 `CONVERSATION_NATIVE_UI_REDESIGN.md`）：浮层 / Voice Orb / 自绘输入框 / 左列页签全部删除，
> 中心列交回 DSH 原生对话，语音降级为 Composer 的输入模式。
> **本文保留**作为第二轮的历史记录；其中**数据纪律、语音链路、工程 Trace 的判据来源**仍适用于新版。

> 日期：2026-09-18 ｜ 插件：`blast-engineering-ui@0.3.0-voicefirst` ｜ 语音：`dsh-voice-scribe@0.4.9`（本地 SenseVoice）+ 系统 `speechSynthesis`
> 结论：**DSH Core 零改动；生产流水线零改动；ML 零改动；未接任何云 ASR/TTS/Realtime API；全程离线。**
> 权限侧见 `DEMO_PROFILE.md`（含本机 2.0.3 permission / approval 机制的源码级结论）。

---

## 1. 这一轮把 UI 变成了什么

```
┌── Context Sidebar ───┬── Agent Stage（中心）──────────────────┬── Preview Pane ──┐
│ Project              │  Voice Orb（7 状态）                   │ 用户点击的       │
│  └ Case AGENT_DEMO_1 │  ↑ 上方：实时识别文本 / 电平           │ artifact 原文：  │
│     └ Design Version │  ↓ 识别完成后 Orb 缩小上移，中央变成    │ FINAL_PLAN       │
│        └ Artifacts   │     Engineering Trace / 结构化差异 /    │ 3D / 装药结构    │
│          （真实交付物）│     结果摘要 + Artifact Links          │ 工程QC / 报告    │
└──────────────────────┴───────────────────────────────────────┴──────────────────┘
```

三栏结构保留；变化在于**中心不再是"聊天记录"，而是 Agent Stage**：

| 需求 | 落实 |
|---|---|
| 默认以 Voice Orb 为视觉中心 | 未识别任何内容时，中央只有 Orb（`data-stage="focused"`）+ 一句提示；Orb 为 canvas 实时绘制 |
| 7 个状态 | `Idle / Listening / Transcribing / Thinking / Executing / Speaking / Interrupted`（`data-orb-state`，同时镜像在头部状态胶囊） |
| 说话时实时文本在 Orb 上方 | Listening 显示"正在听…"+ 真实麦克风 RMS 电平条；转写阶段如实显示"识别中…"；识别文本落地后显示原文（不伪造流式中间结果） |
| 识别完成后 Orb 缩小上移 | `[data-shrunk]` 260 ms ease，中央切换为 Trace / 差异 / 摘要 |
| 只显示真实工程步骤 | Engineering Trace 的 6 步直接来自该项目自身的 `AGENT_RESULT.json → stages`（`input_validation / phase6 / rbr_validation / canonical_geometry / geometry_generation / charge_recommender / joint_calibration / charge_structure / unified_qc / cad_export / charge_drawings`）；运行中只按 `STATUS.json` 的粗粒度 stage 标注"进行中"，并在界面上写明判据来源 |
| 不展示模型私有 CoT | 中心 renderer 里没有任何 `think` / `reasoning` / 工具调用数据的读取路径 |
| Think/Pwsh/Read/Write/raw stderr 只在折叠的 Technical Trace | 这些全部留在**原生 DSH 对话**里；`▸ Technical Trace` 默认折叠，展开后本插件把中心让回原生对话（`data-hidden`），右上角出现「返回 Agent Stage」 |
| Artifact Link 点击后右侧原地预览 | `[平面布孔图] [3D炮孔布置] [装药结构] [工程QC] [设计报告]`（Codex 风格），点击只改一个 state，URL 不变、不开新页 |
| 第一屏不得出现绝对路径 / Task ID / raw JSON / token 数据 | 断言实测通过（见 §3 第 3 步；`/manifest` 里的 `package_dir`、`task_id` 一律不进入工作区 DOM） |
| 参数变更先出结构化差异 | `shaft_diameter_m  5 m → 5.5 m`，`from` 取当前版本 `INPUT.json` 的真实值，`to` 取语音数字；按钮文案 `Create new design version?` / 破坏性动词走另一分支（Confirm 禁用） |
| 确认后才运行 | 唯一执行路径是 `Confirm` 的 onClick：把**结构化差异转成的指令**写进当前会话草稿并提交；代码里没有任何其它 `submit()` |

### 1.1 Orb 视觉规范（Minimal Industrial Intelligence）

* 暗灰底，**单一冷色强调** `#6f9fc4`（警示色 `#c9a26b` / 异常 `#b8756a` 仅用于语义）；
* Idle：半径 60 px 的呼吸环（周期 ≈3.4 s，幅度 ±2.2 px）+ 极淡实心核；
* Listening：环半径与线宽随 **真实 microphone RMS** 变化（自适应噪声底 + 20 Hz 采样），外加 48 根来自 AnalyserNode 频谱的径向刻度；
* Speaking：与 Listening **不同**的规则波形（θ·6 调制 + 慢包络），颜色转为克制的绿；
* Transcribing / Thinking / Executing：单一旋转弧（0.95 s / 1.6 s），Executing 另有 2.4 s 的淡黄进度脉冲；
* Interrupted：420 ms 内扩张并淡出的暗红环，然后回 Idle；
* 过渡：所有动画量在绘制循环内按 **250 ms** 时间常数缓动（落在 180–350 ms 区间），无 CSS 动画与 canvas 争抢；无 Siri 彩虹、无霓虹、无粒子。

### 1.2 语音链路（与第一轮一致，未新增任何自研语音组件）

```
🎙（工作区头部按钮 / composer 里的 scribe 按钮）
  → dsh-voice-scribe 录音 → host 侧 SenseVoice 本地识别（音频不出本机）
  → 文本落入"当前会话"输入框（不自动发送）
  → 本插件镜像文本 → 命中参数变更 → 结构化差异闸门
  → Confirm → 同一会话执行 → /activity 轮询 → Trace → 摘要 + Artifact Links
🔊 朗读结论：host 端白名单脚本（仅最终状态/核心结果/关键 warning）→ speechSynthesis
🗣 朗读途中开口：scribe 一进入录音即取消播放，Orb 进入 Interrupted
```

> 工作区头部新增 `🎙 说话`：它**不自己录音**，而是去按 `dsh-voice-scribe` 自己的按钮；
> 空白会话里 composer 尚未提供麦克风按钮时，退化为按该插件文档化的 **Alt 热键**（本机实测可用）。

---

## 2. 本轮改动的文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `blast_engineering_ui/lib/client.js` | **重写**（0.2.0-voice1 → 0.3.0-voicefirst，约 1800 行） | 三栏工作区：Context Sidebar / Agent Stage（Orb + Trace + 闸门 + 摘要 + Artifact Links）/ Preview Pane；Technical Trace 折叠让位原生对话 |
| `blast_engineering_ui/lib/case-store.mjs` | 改（新增 3 个只读函数） | `activity()`（含正在运行的 task，供实时 Trace）、`stages()`（读 `AGENT_RESULT.json → stages`）、`runtime()`（读 `RUNTIME_PROVENANCE.json`） |
| `blast_engineering_ui/lib/api.mjs` | 改 | 新增 `/activity` `/stages` `/runtime`；`/health` 版本号 0.3.0-voicefirst |
| `blast_engineering_ui/lib/blast-tools.mjs` | **新增** | Demo Profile 的 tool 插件：`blast_engine`（固定 argv）+ `blast_shell`（白名单 + 审批） |
| `blast_engineering_ui/demo-profile/{agent.cordis.template.yml,preset.yml}` | **新增** | 演示 preset 模板与展示元信息 |
| `blast_engineering_ui/tools/install-demo-profile.mjs` | **新增** | 安装/查询/卸载 preset（可选 `--set-default`，改 settings 前先备份） |
| `blast_engineering_ui/tools/demo-profile-test.mjs` | **新增** | 演示 Profile 离线自检（31 断言，含真实 adapter 调用） |
| `blast_engineering_ui/tools/host-contract-test.mjs` | 改 | 增加 `/activity` `/stages` `/runtime` 契约断言（17/17） |
| `agent_adapter/config.py` | 改（**非冻结目录**） | `apply_single_process_env()`（import 时把 5 个变量落到本进程）+ `runtime_provenance()` + `log_provenance_line()`；`describe()` 暴露之 |
| `agent_adapter/services/analysis_service.py` | 改 | 每个任务落盘 `RUNTIME_PROVENANCE.json`、写入日志与 `STATUS.json`，`task-status` 返回 `runtime_provenance`；后台 spawn 也记录 provenance |
| `_stage_probe/*.mjs` | **新增**（探针，非产品代码） | 验收驱动 `voice_first_acceptance.mjs`、Profile 证据运行 `engine_run_provenance.mjs` 等；删掉不影响产品 |
| `%USERPROFILE%\.dsh\.agent-presets\blast-demo\` | **新增**（仓库外，可一键删除） | 安装出来的预设 |
| `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` | 改（用户 patch 层，已备份） | 追加 `agent-presets.default: blast-demo`；删掉该段即回滚 |

**没有改动**：`51_/17_/23_/43_/47_/49_/50_/52_/53_/55_/PREBLAST_*`，以及任何 DSH Core / asar 文件。

---

## 3. 验收（真实 DSH Desktop + 真实案例 + 真实流水线）

驱动：`node _stage_probe/voice_first_acceptance.mjs`
（CDP 附着到真实 Electron renderer；假麦克风 = Chromium fake capture + `_voice_probe/fixtures/q2_diameter.wav`；
识别仍然是**真的**：scribe 录音 → host 侧 SenseVoice 本地转写）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 三栏工作区挂载（Context Sidebar / Agent Stage / Preview Pane） | ✅ PASS |
| 2 | 启动页 Voice Orb 为视觉中心、状态 Idle | ✅ PASS |
| 3 | 第一屏无绝对路径 / 无 Task ID / 无 raw JSON | ✅ PASS |
| 4 | 启动安静（未自动朗读） | ✅ PASS |
| 5 | 选中真实 5.0 m Design Version | ✅ PASS |
| 6 | Listening：Orb 与状态胶囊镜像、真实 RMS 电平 | ✅ PASS |
| 7 | 本地识别文本落到 Orb 上方 | ✅ PASS（`把井筒直径改成5.5米，重新计算，…`） |
| 8 | 参数变更**不立即执行**，显示结构化差异 | ✅ PASS |
| 9 | 差异带真实字段名与单位：`shaft_diameter_m 5 m → 5.5 m` | ✅ PASS |
| 10 | 确认前输入框里没有可执行指令 | ✅ PASS |
| 11 | 用户确认（Create new design version） | ✅ PASS |
| 12 | 真实 Engineering Trace（6 步）随运行显示 | ✅ PASS |
| 13 | 无通用 sandbox escalation / danger-full-access 弹窗 | ✅ PASS |
| 14 | 任务完成 + 中央结果摘要 | ✅ PASS（6 步全部 done） |
| 15 | 五个 Artifact Links 齐全 | ✅ PASS |
| 16 | 完成后第一屏仍无路径 / Task ID / raw JSON | ✅ PASS |
| 17 | 点 `[平面布孔图]` → 右侧预览真实 `FINAL_PLAN.png`（2100×1260），URL 不变 | ✅ PASS |
| 18 | `[3D炮孔布置] [装药结构] [工程QC] [设计报告]` 都在同一预览区切换 | ✅ PASS |
| 19 | 预览切换不跳页 | ✅ PASS |
| 20 | TTS 播报（白名单脚本） | ✅ PASS |
| 21 | 用户开口打断朗读（speak-to-interrupt） | ✅ PASS（`voice=interrupted, speaking=false`） |
| 22 | Think / Pwsh / raw stderr 不在工作区表面 | ✅ PASS（断言限定在本插件表面） |
| 23 | Technical Trace 默认折叠 | ✅ PASS |
| 24 | 展开后露出原生 DSH 对话并隐藏工作区浮层 | ✅ PASS |
| 25 | 「返回 Agent Stage」可用 | ✅ PASS |

**28/29 → 修正断言作用域后全部通过**（唯一的 FAIL 是断言误把"原生对话的 DOM"当成"工作区表面"：
原生对话仍挂在树里（只是被浮层遮住、默认折叠），断言已限定到 `[data-blast-workspace]` 的 innerText）。

### 3.1 截图（真实渲染器 `Page.captureScreenshot`，非合成）

| 文件 | 内容 |
|---|---|
| `docs/screenshots/voice-first/01_startup_voice_orb.png` | 启动页：Voice Orb 为视觉中心 + 左侧 Project/Case/Version/Artifacts + 右侧空预览 |
| `docs/screenshots/voice-first/02_listening_live.png` | Listening：麦克风 RMS 驱动的圆周波动 + 上方"正在听…" |
| `docs/screenshots/voice-first/03_parameter_change_gate.png` | 识别完成 → Orb 缩小 + `Create new design version?` 结构化差异 |
| `docs/screenshots/voice-first/04_executing_engineering_trace.png` | Executing：真实 Engineering Trace（6 步） |
| `docs/screenshots/voice-first/05_completed_with_artifacts.png` | 完成：结果摘要 + 五个 Artifact Links |
| `docs/screenshots/voice-first/06_plan_preview_right_pane.png` | 右栏原地预览真实 `FINAL_PLAN.png` |
| `docs/screenshots/voice-first/07_report_preview_right_pane.png` | 右栏原地预览真实 `ONE_CLICK_REPORT.md` |
| `docs/screenshots/voice-first/08_speaking_tts.png` | Speaking：不同但克制的波形 |
| `docs/screenshots/voice-first/09_interrupted_by_voice.png` | 开口打断朗读 |
| `docs/screenshots/voice-first/10_technical_trace_open.png` | Technical Trace 展开（原生对话 + 工具调用） |

同一次运行还输出 `_stage_probe/acceptance_report.json`（逐条断言 + 控制台/异常记录）。

---

## 4. Demo Profile 侧的证据（与 UI 验收相互独立）

| 证据 | 结果 |
|---|---|
| `blast_engineering_ui/tools/demo-profile-test.mjs` | **31/31 PASS**（含 2 条允许 / 8 条近似命中全部拒绝、fail-closed、allowed-once、真实 adapter 调用、provenance） |
| `_stage_probe/engine_run_provenance.mjs` | 用 `blast_engine` 在真实 case `POC_PROV_1` 上跑通完整流水线：`phase=done`（55.5 s）、`status=CANDIDATE_REFERENCE`，读回真实指标（炮孔总数 61 / 总装药 147.696 kg / q 1.713 kg/m³ / 井筒直径 5.5 m） |
| 同上：工具侧 provenance | `BLAST_AGENT_SINGLE_PROCESS=1`、`BLAST_AGENT_ORIGIN=dsh-demo-profile`、argv 为固定 argv（`-m agent_adapter.cli run-analysis …`，无 shell） |
| 同上：**计算进程自己**的 provenance | `origin=dsh-demo-profile`、`origin_detail=blast_engine:run_analysis`、`single_process.enabled=true`、`effective_in_this_process` 5 项全部就位 |
| `agent_adapter/workspace/logs/runtime_provenance.jsonl` / `tasks/<id>/RUNTIME_PROVENANCE.json` | 每个任务一条，长期可审计 |

机制细节（本机 2.0.3 的 permission/approval 源码结论、preset 组装、白名单形状、安装与回滚）见 **`DEMO_PROFILE.md`**。

---

## 5. 怎么跑

```powershell
# 1) 离线自检（不需要 DSH、不需要 LLM）
node blast_engineering_ui\tools\selftest.mjs             # 数据层 19/19
node blast_engineering_ui\tools\host-contract-test.mjs   # 宿主+HTTP 契约 17/17
node blast_engineering_ui\tools\demo-profile-test.mjs    # Demo Profile 31/31

# 2) 安装 Demo Profile（幂等）
node blast_engineering_ui\tools\install-demo-profile.mjs --install --set-default

# 3) 起 DSH Desktop（本机语音验收用假麦克风；真机演示去掉最后两个参数即可）
#    --remote-debugging-port=9223            仅验收驱动需要
#    --use-fake-device-for-media-stream / --use-file-for-fake-audio-capture=…  假麦克风
Start-Process "<DSH_INSTALL_DIR>\DSH Desktop.exe" `
  -ArgumentList '--remote-debugging-port=9223','--use-fake-device-for-media-stream','--use-ui-fake','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=…\q2_diameter.wav' `
  -WorkingDirectory '<REPO_ROOT>'

# 4) 驱动验收（真实 UI + 真实会话 + 真实流水线，约 6~10 分钟）
node _stage_probe\voice_first_acceptance.mjs
```

---

## 6. 已知问题与限制（如实记录，供下一轮）

| # | 问题 | 现状 / 绕行 |
|---|---|---|
| 1 | **新会话/切换会话入口在本插件遮蔽的官方侧栏里** | 本插件在左列注册的 Context Sidebar 以 `priority: -1` 遮蔽了官方会话侧栏（round 1 的既有设计），因此"新建会话/切换会话/选择 Agent 预设"只能在官方侧栏里操作。本轮加了一个 `会话 / 新建` 按钮 + `localStorage['blast.ui.sidebar']='official'` 标志位用于让位——但**该标志位在本机实测未生效**（页面上仍是本插件的侧栏，原因未定位：同一 `localStorage` 键用 CDP 读得到 `official`，插件内判定却走了另一支）。下一轮要么把会话管理接进本插件侧栏（`api.sessions.create` 之类的宿主 RPC），要么把 Context Sidebar 注册到官方侧栏内部的子槽位而不是遮蔽它。 |
| 2 | 中心浮层覆盖 composer（可输入区） | 工作区浮层覆盖中间列（含 composer 条），因此**打字输入必须**先展开 Technical Trace（原生对话回到中心，composer 可用）。语音路径不受影响：头部 `🎙 说话` 直接驱动 scribe。曾尝试按"composer 高度"给浮层留底部内边距，但空白会话里 composer 是居中的 hero 形态，度量不可靠，故本轮不做。 |
| 3 | 空白会话的 composer 里没有 scribe 麦克风按钮 | 已用该插件文档化的 **Alt 热键**兜底（本机实测有效）；官方会话建立第一条消息后，composer 的麦克风按钮即出现，`🎙 说话` 会优先按它。 |
| 4 | 运行中的 Trace 只有粗粒度 stage | 前台/后台 worker 的 `STATUS.json` 只记录粗粒度 `stage`；单步完成判据在 `AGENT_RESULT.json` 里（完成后才有）。因此运行中界面按 stage 映射"当前步"，并在 UI 上写明判据来源，不用假进度。 |
| 5 | 本轮未做全双工 | 仍是"点一下开始 / 再点一下结束"（scribe 的模式）；不做自研 VAD。`dsh-voice-mode` 属于下一轮候选。 |
| 6 | 演示 preset 里的 agent 无法自由访问文件系统 | 这是最小权限的代价，也是设计目标；数据一律经 `blast_engine` 返回。 |
| 7 | 本轮未接任何 MCP / 云端 | 按 brief 要求停在 POC。 |
| 8 | `blast_engine` 由宿主进程直接 spawn（不经 `ctx.shell` 沙箱） | argv 封闭、无 shell、逐参数校验；若下一轮要收紧到沙箱内，需要 Core 侧提供"固定 argv、无命令解释器"的执行面（见 `DEMO_PROFILE.md` §6）。 |
| 9 | DSH 处于"未选择工作区"状态时，必须由人点一次「选择工作区」 | 这是 DSH Desktop 自身的首启/重置状态（composer 里列出工作区供选择）。本插件已自动让位：检测到 composer 提示"选择一个工作区开始"时，工作区浮层自动隐藏并留一个「显示工程工作区」按钮，因此该选择框不会再被浮层挡住。验收驱动的合成点击无法完成这次原生选择（需要真实鼠标），所以环境准备时**需要人点一下**。 |

---

## 7. 回滚

1. 恢复 profile patch 层：删除 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 里的 `agent-presets` 段（或用 `cordis.patch.yml.bak-blast-ui-phase2` 覆盖）→ 重启 DSH Desktop；
2. `node blast_engineering_ui\tools\install-demo-profile.mjs --uninstall`（删 preset 目录、恢复 settings 备份）；
3. 插件本体回滚：删除 patch 层里的 `blast-engineering-ui` 行并 `rmdir` 两处 junction（见 `README.md` §4.2）；
4. 探针目录 `_stage_probe/` 可整体删除（含验收脚本与截图产出驱动），不影响产品；
5. `agent_adapter` 侧新增的 provenance 是**只增字段**（`RUNTIME_PROVENANCE.json` / `STATUS.json.runtime_provenance` / 日志行），不改变任何数值；如需完全回退，`config.py` 的 `apply_single_process_env()` 调用可去掉，行为回到"仅后台 worker 注入"。
