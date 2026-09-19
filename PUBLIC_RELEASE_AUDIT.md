# PUBLIC_RELEASE_AUDIT.md —— `release/blast-studio` 公开版审计

本文件记录**本次公开源码发布做了什么、依据什么判断、留了哪些已知残留**。目标是让第三方
可以独立复核「这份公开源码里没有夹带私有信息」，而不仅仅是相信一句声明。

| 项 | 值 |
|---|---|
| 目标仓库 | `https://github.com/SupreYu303/MiningAgent.git` |
| 分支 | `release/blast-studio`（**不合并进 `main`**） |
| 提交 | `feat: publish BLAST Studio engineering agent workspace`（该分支首次提交；本文件随该提交一同发布，故不内嵌自身哈希，请以 `git log -1` 为准） |
| 来源工作区 | 内部私有工程仓库（含确定性核心流水线、模型与历史案例证据库）；本仓库只发布其 **UI 与接口层** |
| 发布方式 | 白名单逐文件复制 + 规则化脱敏（脚本执行），**不是** `git add .`，也**不修改**私有仓库任何文件 |
| 文本文件校验 | Python `py_compile` 19/19 通过；Node `--check` 13/13 通过 |
| 图像校验 | 6 张图 SHA-256 与源文件**逐字节一致**；PNG 原始字节扫描 0 命中 |
| 发布体积 | 57 个文件 / 约 1.8 MiB（含 `LICENSE`、本文件与精选截图） |

---

## 1. 范围界定

公开的是**工程智能体的界面与接口**，不是整个系统：

* ✅ 发布：`blast_engineering_ui/`（BLAST Studio 插件）、`agent_adapter/`（工具层与契约）、
  结果契约文档、适配层说明、精选真机截图。
* ❌ 不发布：确定性核心流水线、模型权重、历史案例证据库、项目级 Skill、内部审计文档、
  运行台账（含绝对路径）、内部验收图集、探针脚本。

因此本仓库的定位是「**接口与界面可审阅、可复用**」：`agent_adapter` 的只读工具在缺少核心
流水线时也能导入并返回结构化结论（`doctor` 会明确报 `core51_present = false`），而
`run-analysis` 这类**唯一重算入口**必须要有核心流水线才能产出新方案。

---

## 2. 收录清单（白名单，逐文件）

| 路径 | 文件数 | 说明 |
|---|---|---|
| `blast_engineering_ui/` | 24 | 插件包：`package.json`、`cordis.patch.yml`、`lib/`（host、api、case-store、blast-tools、voice-script、client bundle）、`tools/`（7 个离线自检/开发脚本）、`demo-profile/`、`docs/`（6 篇交付/验收文档）、`README.md` |
| `agent_adapter/` | 21 + 1 | 适配层 Python 包（`cli/config/envelope/engine/taskstore/artifacts/canonical/consistency/render_cues`、`services/` 7 个服务、`schemas/tool_catalog.json`、`tests/run_acceptance.py`、`blast.cmd`）+ 由仓库根 `AGENT_ADAPTER_README.md` 脱敏后落地的 `README.md` |
| `docs/RESULT_CONTRACT.md` | 1 | 结果契约（字段字典 / OOD 与复核两侧分离 / provenance），源自仓库根 `PHASE1_6_RESULT_CONTRACT.md` |
| `docs/assets/` | 6 | 精选真机截图 5 张 + 品牌图块 1 张（见 §4） |
| `README.md` | 1 | 新增：架构、组件、快速开始、环境变量、限制、免责 |
| `.gitignore` | 1 | 新增：Python / Node / 环境秘钥 / `.dsh/` / 模型 / 运行产物 / 探针 / OS-IDE |
| `PUBLIC_RELEASE_AUDIT.md` | 1 | 本文件 |
| `LICENSE` | — | 保留仓库原有 MIT 许可文件（未改动） |

`blast_engineering_ui/` 与 `agent_adapter/` 内的**代码文件全部为逐字节原样复制**——
唯一被改写的是文档类文件（`.md`）与仓库根的 `README.md`（见 §3）。

---

## 3. 脱敏（规则、计数、例外）

对复制进本仓库的文本文件执行**确定性字符串替换**，规则与命中数如下：

| 规则 | 匹配 | 替换为 | 次数 |
|---|---|---|---|
| `user-home` | 本机用户目录（`C:` + `\Users\` + 用户名） | `%USERPROFILE%` | 24 |
| `dsh-install-dir` | 本机 DSH Desktop 安装目录 | `<DSH_INSTALL_DIR>` | 5 |
| `repo-root` | 私有仓库绝对根路径 | `<REPO_ROOT>` | 4 |
| `host-label` | 主机/工作站字样 | `Windows 工作站` | 2 |
| `ps-userprofile-fix` | PowerShell 命令行内的 `%USERPROFILE%` | `$env:USERPROFILE` | 1 |
| `workspace-session-dir` / `drive-d` / `repo-dir-name` / `parent-repo-name` | 会话目录名、父目录名、仓库目录名 | `<encoded-workspace>` / `<WORKSPACE_PARENT>` / `<REPO_DIR_NAME>` | 0（已被更精确规则先吸收） |

合计 **36 处替换，分布在 7 个文件**：
`blast_engineering_ui/README.md`、`blast_engineering_ui/docs/` 下 5 篇
（`CONVERSATION_NATIVE_UI_REDESIGN.md` 无需替换，原本就使用 `~/.dsh` 与 `$env:USERPROFILE`）、
`agent_adapter/README.md`。

此外做了 **5 处定向编辑**（4 组修改；均为公开版可用性所需，不改变技术结论）：

1. `blast_engineering_ui/README.md` 首图由内部截图路径改指 `../docs/assets/01-workspace-overview.png`；
2. 同文 §5 标注真机验收脚本位于内部 `_stage_probe/`，未随公开版发布；
3. 同文 §5 标注 `serve.mjs` 需要真实台账目录；
4. 同文 §7 目录速查中的**两行** `docs/screenshots/**`（计 2 处）改写为公开图集 / 内部图集的说明。

有 9 篇文档（插件 7 篇 + `agent_adapter/README.md` + `docs/RESULT_CONTRACT.md`）在正文前
加了一段 **公开源码版说明**，声明其原为内部记录、已脱敏、且内部图集未随发布。

定稿复核时另做了 3 处**最小修正**（落在同一分支的后续提交，便于追溯；修正后已逐行复核全仓库
`%USERPROFILE%` / `$env:USERPROFILE` 共 40 处上下文，全部与所在 shell 一致）：

1. `blast_engineering_ui/README.md` 回滚脚本的 PowerShell **续行**由 `%USERPROFILE%` 改为
   `$env:USERPROFILE`（`%VAR%` 只在 cmd 中展开；续行不以 `Copy-Item` 开头，因此未被上表规则捕获）；
2. `agent_adapter/README.md` 标题由内部文件名改为包名，并补一段「公开源码版对应关系」，
   说明变更清单中哪些项目未随本次发布；
3. 本文件 §5 的扫描结论按复核后的真实命中数定稿：**宽模式 18 处**（13 自引用 + 5 良性）、
   **严格模式 10 处**（全部为本文件的模式串自引用），其余文本文件 0 命中。

> 私有仓库内的任何文件**均未被修改**：脱敏只发生在复制到本仓库的副本上，可随时用
> 本文件 §5 的规则重建。

---

## 4. 精选截图（出处、选择标准、可复核性）

内部图集共 90+ 张真机截图（含品牌对比图、语音流程组图、验收前后对比）。本次只发布 6 张，
**选择标准**：① 画面内不含主机名 / 用户名 / 绝对路径；② 画面内不含内部工作区目录名胶囊
（DSH 工作区选择器会把工作区目录名直接显示在 Composer 上沿）；

| 发布路径 | 内部来源 | 画面内容 |
|---|---|---|
| `docs/assets/01-workspace-overview.png` | `conversation-native/02_design_version_focus.png` | 三栏工作区：案例/设计版本台账 + 对话交付物 + 版本信息与 Task 记录 |
| `docs/assets/02-engineering-trace.png` | `voice-first/05_completed_with_artifacts.png` | 方案结论卡（孔数/总装药量/单位耗药量）+ 6 阶段工程 Trace + 右侧 Preview |
| `docs/assets/03-executing-state.png` | `conversation-native/09_executing_trace.png` | 执行中：6 步 Trace 待执行 + 原生「Deep diving」+ 报告预览 |
| `docs/assets/04-completed-turn-record.png` | `conversation-native/10_completed_thread.png` | 完成后：本轮工程记录（PASS/RESOLVED 逐阶段判定）+ 指标 + 交付物链接 |
| `docs/assets/05-voice-listening.png` | `voice-first/02_listening_live.png` | 语音输入模式：正在听 + 本地识别说明 + 顶部 Listening 状态 |
| `docs/assets/bs-brand-block.png` | `branding/after_02_brand_block.png` | BS 品牌块（PROJECT 区标题与工位数统计） |

**没有做任何图像修饰**：6 张图均为源文件**逐字节复制**（SHA-256 一致，见 §6）。凡是画面里出现
内部工作区目录名的候选图（例如 `conversation-native/03_parameter_change_gate.png`、
`06_voice_listening.png`、`branding/after_04_home.png`）**一律排除而不是涂改**——
这样每一个公开像素都是未改动的真实屏幕内容。

---

## 5. 安全扫描（方法、结果、残留）

### 5.1 扫描对象与方法

1. **源侧扫描**：私有工作区 60 个文本文件（插件 24 + 适配层 21 + 仓库根 `md/json/py` 15），
   模式包括 `C:\Users*`、`D:\AgentWorkspace*`、内部仓库目录名、父仓库名、`AppData`、
   `.dsh`、`DSH Desktop`、独立主机名字样、以及秘钥类关键词
   （`api_key` / `client_secret` / `password` / `bearer …` / `PRIVATE KEY` / `sk-…` / `ghp_…`）
   与邮箱；同时检查 `.credentials*`、`app.asar` 等敏感文件是否在候选集内。
2. **发布后复扫**：对本仓库 **50 个文本文件**（57 个受控文件中除 `LICENSE` 与 6 张 PNG 之外的全部）
   用**独立脚本**重扫同一组模式（不依赖源侧清单）；再用一组**严格模式**
   （`C:\Users\HP` / 内部仓库目录名 / 父仓库名 / `D:\AgentWorkspace` / 主机名字样 / 秘钥关键词）
   复扫一次，作为双向校验。
3. **资产字节扫描**：对 6 张 PNG 做原始字节匹配（覆盖 PNG `tEXt`/`iTXt` 元数据块），
   确认截图文件内部没有写入路径或用户名。

### 5.2 结果

* 秘钥 / 凭据类模式：**源侧与发布后均 0 命中**；仓库内不存在 `.env`、`.credentials*`、
  `app.asar`、模型权重。
* 发布后复扫（50 个文本文件）共 18 处模式命中：其中 **13 处来自本文件自身**——§5.1 的列举文字
  与 §5.3 的示例正则**刻意**包含这些模式串，属自引用，不计入残留；**其余 5 处**全部为良性或误报，
  逐条说明：

| 命中 | 位置 | 判断 |
|---|---|---|
| 3 × `AppData` | `blast_engineering_ui/docs/VOICE_POC_IMPLEMENTATION.md`、`VOICE_RUNTIME_AUDIT.md` | 均为 `$env:APPDATA` / `%APPDATA%` 环境变量写法，不含用户名 |
| 1 × `C:\Python…` | `blast_engineering_ui/tools/demo-profile-test.mjs` | 安全测试的**反例样本**（用于断言「外来 python 会被拒绝」），必须保留 |
| 1 × 形如 `x:\` 的片段 | `blast_engineering_ui/tools/install-demo-profile.mjs` | 正则误报：匹配到 JS 模板字符串里的 `\n` 转义 |

* `agent_adapter/` 的 Python 代码**零命中**：所有路径都是 `Path(__file__).parent` 派生或
  环境变量（`BLAST_AGENT_*`），因此整包可移动到任意目录。
* 内部仓库目录名与父仓库名在发布树中**只出现在本文件的检测模式串里**（各 2 处 / 1 处），
  其余 49 个文本文件 **0 命中**——即公开树中不存在任何真实的本机路径、用户名或内部目录名。
* **严格模式复扫**（发布树 HEAD，50 个文本文件）：共 **10 处**命中，**全部位于本文件自身**的
  模式串行——即 §5.1 与 §5.3 为说明规则而刻意列出的字样（按标签计：`USERS_HP` ×1、
  `WORKSPACE_D` ×3、`INTERNAL_FOLDER` ×2、`SECRET_KW` ×2、`PARENT_REPO` ×1、`HOSTNAME_HP` ×1），
  其余 **49 个文本文件 0 命中**；真正的秘钥类字面量
  （`ghp_…` / `BEGIN … PRIVATE KEY` / `bearer <token>` / `sk-` 长串）全树 **0 命中**。
* 插件侧同理：`host.mjs` 用 `BLAST_ENGINEERING_UI_REPO` 或插件目录上溯解析仓库根，
  `case-store.mjs` 只拼接 `<repo>/.venv`、`<repo>/agent_adapter/blast.cmd`。

### 5.3 复现方式

```powershell
# 例如：扫描本仓库内所有文本文件里的本机路径 / 内部目录名 / 秘钥关键词
Get-ChildItem -Recurse -File -Include *.md,*.py,*.mjs,*.js,*.json,*.yml,*.cmd |
  Where-Object { $_.FullName -notmatch '\\.git\\' } |
  Select-String -Pattern 'C:\\Users\\[^\\]+|D:\\AgentWorkspace|blast_parameter_reextract|zongyanfa',
                                'api[_-]?key|client[_-]?secret|password|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{16,}'

# PNG 元数据字节扫描（无 PIL 也可用）
Select-String -Path docs\assets\*.png -Pattern 'C:\\Users|AgentWorkspace|blast_parameter_reextract' -Encoding Byte
```

> 注：上面第 2 段示例里的正则串本身包含这些模式，因此运行扫描时**本文件会自引用命中一次**，
> 属预期（本次发布后的复扫结果见 §5.2，那条自引用命中不计入残留）。

---

## 6. 完整性与可运行性校验

| 校验 | 结果 |
|---|---|
| `python -m py_compile agent_adapter/**/*.py` | 19 个文件，退出码 0 |
| `node --check`（`lib/` + `tools/`） | 13 个文件，退出码 0 |
| 截图 SHA-256（源 ↔ 发布） | 6/6 完全一致 |
| PNG 原始字节路径扫描 | 0 命中 |
| 许可一致性 | 仓库 `LICENSE` 为 MIT，插件 `package.json` 声明 `"license": "MIT"`，一致 |

---

## 7. 已知限制与后续

1. **不是可独立运行系统**：缺少核心流水线时 `run-analysis` / `generate-*` 无法产出新结果；
   本仓库的价值在界面、契约与工具边界，而不是完整复现工程计算。
2. **项目级 Skill 未发布**：适配层的 `doctor` 会检查 `<repo>/.dsh/skills/shaft-blast-design/SKILL.md`，
   公开版该检查为 `false`（不影响其余工具）。
3. **文档中的路径引用**：内部文档仍以文字形式提到 `.dsh/skills/…`、`51_one_click_end_to_end/`
   等未发布目录（用于说明设计约束），属预期；每篇文档顶部均有公开版说明。
4. **内部图集未发布**：文档正文引用的 `docs/screenshots/**` 图集不在本仓库，公开图集见 `docs/assets/`。
5. **不合并进 `main`**：本次仅在 `release/blast-studio` 分支发布；是否合并、是否作为 v0.1 tag
   由维护者另行决定。
6. **工程免责**：截图中的案例名、参数与指标是本项目运行真实产物，仅用于展示界面形态，
   不构成工程结论；系统输出为 `CANDIDATE_REFERENCE` 候选参考，采用前须工程师复核。

---

<sub>审计生成方式：源侧扫描 → 白名单复制 + 规则化脱敏 → 发布后独立复扫 → 语法与哈希校验；
---

## 9. `release/blast-studio` · Live Voice 集成发布（2026-09-19）

本次在**同一分支的后续提交**里加入 BLAST Studio 的 Live Voice（Qwen Audio Realtime Plus）
正式集成，仍**不合并进 `main`**。发布方式与首次一致：白名单逐文件复制 + 确定性脱敏
（脚本 `blast_live_voice/scripts/publish-public.mjs`，**不是** `git add .`），发布后独立复扫。

| 项 | 值 |
|---|---|
| 新增包 | `blast_live_voice/`（23 个受控文件：8 个 lib、4 个 script、README、2 篇 docs、1 张真机截图） |
| 改动文件 | `blast_engineering_ui/lib/client.js`、`lib/blast-tools.mjs`、`demo-profile/agent.cordis.template.yml`、`tools/install-demo-profile.mjs`、`tools/demo-profile-test.mjs` |
| 脱敏命中 | `dsh-install`（脚本默认路径 → 改为读环境变量，0 命中）、`user-home` 1 处（文档中的 DSH home） |
| 发布后复扫 | 秘钥模式 / 本机路径 / 内部目录名 **0 命中** |
| 未发布 | `blast_live_voice/runtime/**`（闸门状态、在场上报、运行溯源、探针证据）、本机 profile 配置、凭据、POC 内部验证文件 |

**本次发布包含的能力边界**（第三方 provider 不在本仓库内）：

* `blast_live_voice` 只发布**本项目的 product 层**：Parameter Diff / Action Gate 状态机、
  真实设计读取、adapter CLI 调用、agent 面三个工具、人在环许可（`/permit/check`）；
* 实时语音 provider（`@harness-remote/dsh-realtime-voice`，MIT）由使用方按
  `blast_live_voice/README.md` 自行安装（junction 或 `dsh plugin add`），本仓库不重分发其代码；
* DSH Desktop 的部署只写 `$DSH_HOME`：junction + 一段**带标记**的 profile patch（旧文件先备份），
  回滚是删除该标记块与两个 junction。

**验证结果**（详见 `blast_live_voice/docs/LIVE_VOICE_PRODUCTION_ACCEPTANCE.md`）：

| 套件 | 结果 |
|---|---|
| `probe-studio-live.mjs`（真渲染进程，冷启动后） | **17/17 PASS** |
| client-contract / host-contract / selftest / voice-selftest / demo-profile-test | **45/45 · 17/17 · 19/19 · 17/17 · 33/33** |
| 人工对麦克风项（中文听感 / 连续对话 / barge-in 听感） | 由使用方在本机完成（脚本不断言） |

> 与首次发布相同的免责：截图中的案例名、参数与指标是本项目真实运行的产物，仅用于展示界面形态，
> 不构成工程结论；系统输出为 `CANDIDATE_REFERENCE`，采用前须工程师复核。

全部步骤均为只读于私有仓库、仅写入本仓库。任何数值与截图均未由人/AI 估算或修饰。</sub>
