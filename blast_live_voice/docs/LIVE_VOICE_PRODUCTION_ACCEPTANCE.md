# LIVE_VOICE_PRODUCTION_ACCEPTANCE.md —— BLAST Studio Live Voice 正式验收

> 日期：2026-09-19 ｜ 环境：Windows ｜ DSH Desktop 2.0.3（harness 0.1.1-rc.2）｜ profile `desktop`（展示名 BLAST Studio）
> 纪律：**只有真正跑过的项才算 PASS**；机器不能验证的项明确标为「必须人工」，不假装通过。

## 0. 一句话

* 机器可验证的 17 项（冷启动 / 📞 入口 / 相位条 / 闸门 / 确认前不执行 / 取消不产生任务）**17/17 PASS**；
* 离线回归 5 套 **131/131 PASS**；
* **必须人工对麦克风**的 3 项（中文听感、连续对话体感、barge-in 听感延迟）在此文档中如实标为待人工，不由脚本断言。

## 1. 复现命令

```powershell
# 合入（幂等）+ 刷新 preset
node blast_live_voice\scripts\deploy-studio-live.mjs --install
node blast_engineering_ui\tools\install-demo-profile.mjs --install

# 冷启动 BLAST Studio（真实 kill + 启动 + 等就绪 + 自检）
powershell -File blast_live_voice\scripts\start-studio.ps1 -Restart -Cdp

# 生产验收（真渲染进程；会开一个真实会话轮次，不会启动任何工程计算）
node blast_live_voice\scripts\probe-studio-live.mjs --timeout 60000
# 证据：blast_live_voice/runtime/probe-studio-live.json
```

## 2. 冷启动（真实重启，不是“刷新页面”）

```
profile=desktop preset=blast-demo home=%USERPROFILE%\.dsh port=43120
gate=http://127.0.0.1:43120/blast-live-voice
stopping DSH Desktop (cold start)
starting D:\...\DSH Desktop.exe --remote-debugging-port=9223
DevTools listening on ws://127.0.0.1:9223/devtools/browser/…
studio READY at http://127.0.0.1:43120/
```

profile id 由 `lib/studio.mjs` 单点提供；脚本里没有手写 profile 名（POC 时代
process/display/profile id 混用的问题已消除）。

## 3. 机器可验证项（`probe-studio-live.mjs`）—— 17/17 PASS

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1 | 找到 BLAST Studio 渲染进程（CDP） | PASS | `http://127.0.0.1:43120/` |
| 2 | Composer 座位冷启动后就绪 | PASS | `[data-voice-strip]` |
| 3 | 工程会话已开始（对话内工程座位存在） | PASS | `conversation.composer.dock` |
| 4 | **Composer 里有实时语音控件（📞）** | PASS | `aria-label=开始实时语音` |
| 5 | Composer 语音/状态座位已挂载 | PASS | `data-state=idle` |
| 6 | 未通话时 Live 状态条不占位 | PASS | `phase=null`（Composer 恢复原文案） |
| 7 | 渲染进程可访问 `/blast-live-voice/live` | PASS | `protocol=dsh.voice.v1` |
| 8 | Live 路由声明唯一执行入口 | PASS | `/blast-live-voice/gate/confirm` |
| 9 | 当前设计真实读数可用（canonical-result） | PASS | `T20260919_003127_AGENT_DEMO_1_cskp shaft_diameter_m=5.5` |
| 10 | 开闸门成功且状态 pending | PASS | `gate=G20260919015242` |
| 11 | **确认前 task_id 为空** | PASS | `taskId=null` |
| 12 | 差异旧值 = 当前设计的真实输入 | PASS | `5.5 vs 5.5` |
| 13 | **对话里出现 Parameter Diff 闸门** | PASS | `status=pending`，`shaft_diameter_m 5.5 m → 6 m` |
| 14 | 闸门提供 `[取消] / [创建版本]` | PASS | `cancel=true confirm=true` |
| 15 | **未人工确认时人在环许可被拒绝** | PASS | `403 no-permit` |
| 16 | 取消闸门成功（方案未改变） | PASS | `status=cancelled` |
| 17 | 取消后闸门文件没有 task_id | PASS | `taskId=undefined` |

截图（真机、目标形态）：`docs/screenshots/live_voice_gate.png`
—— 三栏结构不变、Composer 右侧蓝色 📞、其下方就是 Parameter Diff 卡与两个人工动作，界面上没有大 Voice Orb。

> 检查 3 说明：DSH 只在**会话开始后**渲染 `conversation.composer.dock`（新会话 hero 没有这个座位）。
> 正式流程是「打开现有工程会话 → 点 📞」，脚本与流程一致：座位不存在时会先发一轮真实对话再继续。

## 4. 离线回归（不需要 DSH / LLM / 麦克风）

| 套件 | 命令 | 结果 |
|---|---|---|
| client-contract | `node blast_engineering_ui\tools\client-contract-test.mjs` | **45/45** |
| host-contract | `node blast_engineering_ui\tools\host-contract-test.mjs` | **17/17** |
| selftest（数据层，真台账 + 真 CLI） | `node blast_engineering_ui\tools\selftest.mjs` | **19/19** |
| voice-selftest | `node blast_engineering_ui\tools\voice-selftest.mjs` | **17/17** |
| demo-profile-test（含新增的 Live 行断言） | `node blast_engineering_ui\tools\demo-profile-test.mjs` | **33/33** |

本轮相对集成前**新增**的断言：preset 模板必须挂 `blast-live-voice/agent-tools` 且带项目闸门 URL
（`demo-profile-test.mjs`），以及本文件 §3 的 17 项。

## 5. 必须人工的项（不由脚本断言）

| # | 项 | 怎么做 | 当前状态 |
|---|---|---|---|
| H1 | 中文语音质量 | 点 📞 → 说「读一下当前设计」→ 看/听回答 | ⏳ 待人工（POC 已人工验收同一 provider + 同一模型） |
| H2 | 连续对话体感 | 连续追问 2–3 轮，不点任何按钮 | ⏳ 待人工 |
| H3 | barge-in 听感延迟 | 播报中直接开口「等一下」→ 音频应立即停并回到「● 正在聆听」 | ⏳ 待人工（协议层三层停播已由 POC 覆盖） |
| H4 | 真实麦克风授权 | 首次点 📞 应弹浏览器/系统授权 | ⏳ 待人工（Electron 实测默认授予） |

人工项未完成前，**不得宣布 Live Voice 生产可用**；机器项已全绿。

## 6. 通过条件对照（用户 §13）

| 条件 | 状态 | 依据 |
|---|---|---|
| Live realtime conversation | ✅ 机器 PASS（建连/相位/控件） | §3 #4/#7；听感见 H1–H3 |
| Chinese speech quality | ⏳ 人工（POC 已验收） | H1 |
| barge-in | ⏳ 人工（POC 已验收；集成后待复听） | H3 |
| session continuity | ✅ 同一个 Studio 会话（不是第二套会话） | §4 集成文档 §3 |
| Parameter Gate | ✅ | §3 #10/#13/#14 |
| no-execution-before-confirmation | ✅ | §3 #11/#15/#17 + 工具面互锁 |
| Engineering Core | ✅ 未改动（只经既有 adapter CLI） | `git diff` 只涉及 UI/JS 与新增包 |
| Conversation | ✅ 同一对话 / Case / Design Version | §3 #3/#13 |
| Preview | ✅ 未改动（同一条 activity → artifact 链） | 设计不变 |
| SenseVoice fallback | ✅ `dsh-voice-scribe` 未动，仍随 profile 加载 | §4 |
| cold restart | ✅ | §2 |
| no credential leakage | ✅ 本包不写 key；扫描见 PUBLIC_RELEASE_AUDIT | 发布扫描 |
| DSH Core untouched | ✅ | 无 Core 文件改动，只改 profile patch 与 junction |

## 7. 已知限制

1. Desktop 只服务自己的渲染进程（裸 loopback 403），因此状态来自渲染进程上报 + runtime 文件；
2. 空白新会话（hero）看不到工程闸门，需打开/开始一个会话（正式流程一致）；
3. 人工 4 项（§5）未完成前不具备“正式可用”的最终结论；
4. 实时 provider 的 junction 目前指向 POC 的 vendor 目录（审计过的同一份包）。
