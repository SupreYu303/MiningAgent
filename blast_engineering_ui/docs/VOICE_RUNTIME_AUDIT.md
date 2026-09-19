# VOICE_RUNTIME_AUDIT.md —— DSH Desktop 2.0.3 语音运行时实测审计

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

> 日期：2026-09-18 ｜ 环境：Windows（Windows 工作站）｜ DSH Desktop **2.0.3**（Electron 43.4.0 / Chromium 150.0.7871.224）
> Harness 版本（决定插件 peer 兼容性）：**0.1.1-rc.2**
> 结论来源：**全部为本机实测**（未做任何假设），原始 JSON 见 `_voice_probe/*.json`。

---

## 0. 一句话结论

| 能力 | Electron（DSH Desktop 窗口内，主目标） | 说明 |
|---|---|---|
| 麦克风采集 `getUserMedia` | ✅ **可用** | 权限自动 granted，真实设备，电平有变化（§2） |
| TTS `speechSynthesis` | ✅ **可用（离线）** | 3 个本地中文 SAPI 音色，实测朗读 5.465 s（§3） |
| STT Web Speech（云端） | ❌ **不可用** | `start()` → `error: network`（Electron 无 Google 语音后端） |
| STT Web Speech（本地 on-device） | ❌ **不可用且危险** | 调用即 **renderer 崩溃**（Mojo 无 binder，§2.4） |
| STT 本地离线（SenseVoice/sherpa-onnx，host 侧） | ✅ **可用** | 在 DSH 运行时下加载成功并准确识别中文（§4） |

**因此：语音输入必须走「host 侧本地 ASR」，不能依赖浏览器 Web Speech。**
这正是本轮选择 `dsh-voice-scribe`（默认本地 SenseVoice）而非 `dsh-talk` 默认引擎的直接原因。

---

## 1. 运行时基线（实测）

```
Harness 版本        0.1.1-rc.2      （由 DSH Desktop 内置 @deepseek-ai/dsh-web-app@0.1.1-rc.2 确定）
Electron            43.4.0
Chromium            150.0.7871.224
Node（host 运行时） 24.18.1，NODE_MODULE_VERSION 148，NAPI 10
DSH_HOME            %USERPROFILE%\.dsh
profile             desktop（bundles: dsh-base, dsh-web-app, @openviking/dsh-memory-plugin）
Web UI              http://127.0.0.1:43120/
```

实测方式：以 Chromium 调试开关启动 DSH Desktop（`--remote-debugging-port=9223`），
用 CDP 附着到**真实 Electron renderer**（`_voice_probe/mic_probe_electron.mjs`）：

```powershell
# 先关闭正在运行的 DSH Desktop，然后（在未设置 ELECTRON_RUN_AS_NODE 的干净 shell 里）：
Start-Process "<DSH_INSTALL_DIR>\DSH Desktop.exe" -ArgumentList '--remote-debugging-port=9223'
node _voice_probe\mic_probe_electron.mjs --seconds=6
```

> 坑：若 shell 残留 `ELECTRON_RUN_AS_NODE=1`（`dsh` CLI 的 shim 会设置它），
> `DSH Desktop.exe` 会退化成 Node 解释器并报 `bad option: --remote-debugging-port=9223`。
> `_voice_probe/electron-node.cmd` 是「以 Node 方式运行」的显式包装脚本，只用于 host 侧脚本探针。

### 1.1 打包外壳未注册 Electron 权限处理器（静态证据）

对 `resources/app.asar`（104,412,135 B）全文扫描 `_voice_probe/asar_scan.cjs`：

| 探针 | 命中 |
|---|---|
| `setPermissionRequestHandler` | 0 |
| `setPermissionCheckHandler` | 0 |
| `microphone` | 0 |
| `getUserMedia` | 7（均为图表库内部实现，与外壳无关） |

→ 外壳不拦截媒体权限请求，走 Electron 默认行为（**请求即授予**），与 §2.1 观察一致。

---

## 2. 麦克风实测（Electron renderer）

原始结果：`_voice_probe/mic_probe_result.json`

### 2.1 权限

```json
"isSecureContext": true,
"permissionQuery": { "state": "granted" }
```

- `granted`，**没有弹出任何授权对话框**，未出现 Electron permission error / `NotAllowedError`

### 2.2 设备列表与音频流

`enumerateDevices()`（授权前即返回，label 已可见，与 granted 一致）：

| kind | label |
|---|---|
| audioinput | `Default - 麦克风阵列 (适用于数字麦克风的英特尔® 智音技术)` |
| audioinput | `Communications - 麦克风阵列 (…)` |
| audioinput | `麦克风 (ToDesk Virtual Audio)` |
| audioinput | `麦克风阵列 (适用于数字麦克风的英特尔® 智音技术)` |

`getUserMedia({audio:true})`：

```json
{ "ok": true, "tracks": 1, "readyState": "live", "enabled": true, "muted": false,
  "label": "Default - 麦克风阵列 (适用于数字麦克风的英特尔® 智音技术)",
  "settings": { "sampleRate": 48000, "channelCount": 1,
                "autoGainControl": true, "echoCancellation": true, "noiseSuppression": true } }
```

停止后 `readyState: "ended"`（资源正确释放）。

### 2.3 输入电平（是否有变化）

AudioContext + AnalyserNode，每 200 ms 取 RMS：

```json
"levelTrace": { "samples": 6, "min": 0, "max": 0.028236, "mean": 0.005816,
                "distinctValues": 6, "varies": true,
                "head": [0, 0.001484, 0.028236, 0.000796, 0.001296, 0.003084] }
```

→ **电平随环境声变化**（非恒定、非全零），采集链路真实工作。

### 2.4 Web Speech（STT）——两条路都不可用

**(a) 云端识别**：构造成功，`start()` 后 `start → audiostart → soundstart → speechstart`，
随后 **`error: network`** 结束：

```json
"webSpeech": { "SpeechRecognition": "function", "webkitSpeechRecognition": "function" },
"recognitionLifecycle": { "verdict": "error",
                          "events": ["start","audiostart","soundstart","speechstart","error:network:"] }
```

原因：Electron 发布产物不含 Google 语音服务后端（无 API key），识别请求无法建立。

**(b) 本地 on-device 识别（Chromium 138+ 能力）**：**直接崩掉渲染进程**，
日志原文（`%APPDATA%\DSH Desktop\logs\dsh-2026-09-18.log`）：

```
Terminating render process for bad Mojo message: Received bad user message:
No binder found for interface media.mojom.OnDeviceSpeechRecognition for the frame/document scope
Terminating renderer for bad IPC message, reason 123
dsh-plugin-desktop: renderer process gone (reason: crashed, exitCode: 3 / 0x00000003)
```

→ Electron 43 未实现该 Mojo 接口：**禁止在 Desktop 内尝试 on-device 识别**。
（窗口随后被 Electron 自动重载恢复，工程数据未受影响。）

---

## 3. TTS 实测（Electron renderer，离线可用）

原始结果：`_voice_probe/tts_probe_result.json`

```json
"speechSynthesisPresent": true,
"voicesImmediate": [
  { "name": "Microsoft Huihui - Chinese (Simplified, PRC)",  "lang": "zh-CN", "local": true, "default": true },
  { "name": "Microsoft Kangkang - Chinese (Simplified, PRC)","lang": "zh-CN", "local": true },
  { "name": "Microsoft Yaoyao - Chinese (Simplified, PRC)",  "lang": "zh-CN", "local": true }
],
"speakResult": { "verdict": "ended", "events": ["start","end"], "elapsedMs": 5465 }
```

- `voiceschanged` 未触发（首次读取即就绪）；3 个音色**全部本地**（不联网）
- 真实合成+朗读成功：`start` → `end`，耗时 5.465 s（文本：*当前五米方案共有五十八个炮孔。*）

---

## 4. 本地离线 ASR（host 侧）实测

这是本轮 STT 的实际落点：`dsh-voice-scribe` 用 **sherpa-onnx（SenseVoice）在 host 进程**做识别，
音频不上云、不经过浏览器语音服务（README 与代码一致：`lib/local-asr.js`）。

### 4.1 模型

| 项 | 值 |
|---|---|
| 目录 | `%USERPROFILE%\.dsh\voice\sensevoice\` |
| 文件 | `model.int8.onnx`（228.2 MB）、`tokens.txt`（315,894 B） |
| 来源 | `https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`（国内镜像） |
| 下载坑 | `Invoke-WebRequest` 不跟随 **308**；`curl` 需 `--ssl-no-revoke`（本机吊销服务器不可达，schannel 报 `CRYPT_E_REVOCATION_OFFLINE`） |

### 4.2 原生模块在 DSH 运行时下可加载

`_voice_probe/asr_probe/asr_result.json`：

```json
"runtime": { "electron": "43.4.0", "node": "24.18.1", "modules": "148", "execPath": "DSH Desktop.exe" },
"load": "ok"
```

→ `sherpa-onnx-node`（NAPI 预编译，含 `sherpa-onnx-win-x64/sherpa-onnx.node` + `onnxruntime.dll`）
在 **Electron 43 宿主进程**中 require 成功，无 ABI（NODE_MODULE_VERSION）不匹配问题。

### 4.3 中文识别准确性（测试音频由本机 SAPI 合成，可复现）

| 音频 | 时长 | 峰值 | 解码耗时 | 识别结果 |
|---|---|---|---|---|
| `q1_holes.wav` | 3.59 s | 0.898 | **160 ms** | **当前方案一共有多少个炮孔？** |
| `q2_diameter.wav` | 4.35 s | 0.875 | **176 ms** | **把井筒直径改成5.5米，重新计算。** |

→ 正是本轮 POC 的 Test 1 / Test 2 文本，**逐字正确**；CPU 解码约 25× 实时。

---

## 5. 候选方案 A/B/C 判定（实测 + 包元数据）

### 5.1 判据

1. 与 DSH Desktop 2.0.3（Harness **0.1.1-rc.2**）的 peer 兼容性；
2. 是否保持 `blast-engineering-ui` 不变；
3. 能否在**当前 Harness conversation / 当前 Case Session**内继续（不新开 Session）；
4. 对 Windows 麦克风权限/系统的影响；
5. STT/TTS 在 Electron renderer 下**是否真的能跑**（§2–§4 的硬事实）。

### 5.2 方案 A：`dsh-talk`（PerryLink）

| 维度 | 事实 |
|---|---|
| npm 现状 | latest `0.3.10`；peer 要求 `@deepseek-ai/dsh-* >=0.1.2-rc.1` 或 `>=0.1.5-alpha.1` |
| 本机可用版本 | **仅 0.3.2 及以前**（peer `>=0.1.0-rc.8 <0.2.0`）→ 0.3.3+ **装不上** |
| 麦克风按钮 | 注册在 `conversation.input.left`（client bundle 实测命中该 slot） |
| STT 引擎 | `auto/web/funasr/whisper`：web 在本机 Electron 下**死**（§2.4）；funasr/whisper 需自装本地引擎 |
| TTS 引擎 | `auto/browser/edge-tts/piper`：browser 引擎在本机**可用**（§3） |
| ⚠️ 致命点 | 官方兼容性声明明确点名 **0.1.1-rc.2 属于"无信封 host"**：`dsh-talk/speech` 事件无法写入 session log → 客户端唯一播放入口 `useProjection("talk:speech")` 恒为空 → **朗读不会被触发**（`lib/types/speech.d.ts` 原文；client bundle 实测只有该一个播放入口 `talk/audio`） |
| 结论 | **部分可用**：能给"麦克风按钮 + 设置页"，但 STT(web) 与 TTS(投影) 在本机都不能真正工作 → 不作本轮载体 |

### 5.3 方案 B：`dsh-realtime-voice`（AlexKaiqi）

| 维度 | 事实 |
|---|---|
| npm 现状 | latest `0.3.3`；peer `@deepseek-ai/dsh-host-webserver ^0.1.1-rc.2` → **与 2.0.3 精确匹配** |
| 额外依赖 | 必须同时装 `dsh-multi-model-provider@^0.1.0-rc.11`（peer 也是 ^0.1.1-rc.2，可满足） |
| 凭据 | 需 **OpenAI Realtime 或豆包 Realtime 凭据**（付费云服务），本机无 |
| 形态 | 是**能力层**（provider-neutral）：README 明示 Agent 身份/上下文/动作授权由 product plugin 拥有 → 落地必须再写一个 product 层（等于自研） |
| 形态冲突 | 定位为**全双工**实时语音（VAD/打断/音频独占租约），且会**新开 Realtime Provider 会话**，与"继续同一 Harness conversation"相悖；本轮也明确不做全双工 |
| 结论 | **不采用（本轮）**：兼容但不是本轮目标，且凭据/产品层依赖过重 |

### 5.4 方案 C：Qwen Audio Agent + ACP

| 维度 | 事实 |
|---|---|
| npm 生态 | `registry.npmjs.org/-/v1/search` 检索未发现 Qwen Audio Agent 的 DSH 插件包 |
| 架构 | 经 ACP 驱动 → **再起一个 Agent/会话**，与 §7「Voice 必须绑定当前 Case/Session」冲突；且需 DashScope 凭据 |
| 结论 | **不采用（本轮）** |

### 5.5 生态里更契合的现成实现

| 包 | 版本 | peer / 兼容 | STT | TTS | 结论 |
|---|---|---|---|---|---|
| **`dsh-voice-scribe`** | 0.4.9 | `@deepseek-ai/dsh-llm >=0.1.0-rc.6`（**满足 0.1.1-rc.2**） | ✅ 本地 SenseVoice（host 侧、零 key、音频不出本机），自动回退 Web Speech | ➖ 无 | ✅ **本轮采用** |
| `dsh-voice-mode` | 0.7.7 | 声明兼容 `0.1.1-rc.2` 起 | ✅ 本地 zipformer2 流式 | ✅ Edge TTS / 本地 VITS | ⏭ 第二轮（全双工）候选 |
| `@nn12138/dsh-voice` | 0.2.6 | 无 peer 约束 | ✅ 本地/浏览器 | ➖ | 备选（"提交为消息"式，闸门不友好） |
| `@goodandready/dsh-voice` | 0.8.30 | `^0.1.0-rc.6` | 云 ASR / whisper.cpp | ➖ | 备选（需云 key 或自装 whisper.cpp） |

### 5.6 四个提问的直接回答

1. **哪个与 DSH Desktop 2.0.3 最兼容？**
   → peer 精确匹配的是方案 B（`dsh-realtime-voice`）；方案 A 必须**降级到 0.3.2**；
   `dsh-voice-scribe@0.4.9` / `dsh-voice-mode@0.7.7` 也都声明兼容。但"装得上"≠"能用"，见 §2–§4。
2. **哪个可以保持 `blast-engineering-ui` 不变？**
   → 三者都不抢占我们的 `sidebar` / `shell.overlay` / `blast.case.tab`：
   `dsh-talk` 占 `conversation.input.left`，`dsh-voice-scribe` 占 `conversation.input.right`，
   我们的主区与 Case 工作区**零改动即可并存**（本轮实测：mic 按钮与我们的 voice pill 同排显示）。
3. **哪个可以在当前 Case Session 中继续用同一个 Harness conversation？**
   → `dsh-talk` 与 `dsh-voice-scribe` 都只是"写进当前 composer 草稿"，**不新建 Session**
   （本轮实测：识别文本落入当前会话输入框，确认后由同一会话的 Agent 执行）；
   方案 B/C 本身引入第二个会话/Agent 通道，不符合。
4. **哪个对 Windows 麦克风权限影响最小？**
   → 三者都只用浏览器 `getUserMedia`：**不改注册表、不改系统麦克风隐私设置**；
   实测外壳不注册 Electron 权限处理器（§1.1），因此权限开销相同（零系统侧改动）。
   `dsh-voice-scribe` 额外把音频**只送到本机 host 进程**（不出网），隐私面最小。

### 5.7 本轮决定

> **STT：`dsh-voice-scribe@0.4.9`**（host 侧本地 SenseVoice，音频不出本机）
> ＋ **TTS：复用系统 `speechSynthesis`**（即 `dsh-talk` 的 `browser` 引擎同一条实现路径：
> 它在本机实测可用，而 `dsh-talk` 的**播放触发链路**在 0.1.1-rc.2 上不可用）。
> 语音 UI（状态条 / 🔊 朗读 / 高影响确认闸门）加在 `blast-engineering-ui` 内，
> **不改 DSH Core、不改生产流水线、不改 ML。**

---

## 6. 风险与限制（如实记录）

| # | 限制 | 影响 | 处理 |
|---|---|---|---|
| 1 | Electron 内 Web Speech 全废（云端 network / 本地崩溃） | 任何依赖浏览器 STT 的插件在 Desktop 内都不可用 | 改用 host 侧 SenseVoice；**禁止**再调 on-device API |
| 2 | `dsh-talk` 朗读链路在 0.1.1-rc.2 上哑火（无 session 事件信封） | 无法"开箱即得"语音播报 | 本轮自行用 `speechSynthesis` 播报；升级 Harness 后再评估 |
| 3 | 首次使用需下载 228 MB 模型 | 首次语音前需等待 | 本轮已预置到 `$DSH_HOME/voice/sensevoice`（一次性） |
| 4 | 本机 TLS 吊销检查不可达 | `curl`/部分下载工具失败 | 用 `curl --ssl-no-revoke`；已记录 |
| 5 | 无 VAD 自动断句（scribe 为点击/按住式） | 停顿不会自动结束录音 | 本轮用"点击开始 / 再点结束"，**不引入自研 VAD** |
| 6 | 假麦克风仅用于可复现测试 | 真机演示需正常启动 | 测试用 `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`；真机演示重启即可 |
| 7 | 状态条 Listening/Transcribing 是"镜像"scribe 的状态行 | 依赖其文案 | 已在 `VOICE_POC_IMPLEMENTATION.md` 记录；不修改插件本体 |


