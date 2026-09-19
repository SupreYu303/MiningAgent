# DEMO_PROFILE.md —— 本地 BLAST 工程 Workspace 的最小权限 Demo Profile

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。

> 日期：2026-09-18 ｜ 环境：Windows (Windows 工作站) ｜ DSH Desktop **2.0.3**（Harness 0.1.1-rc.2）
> 结论：**DSH Core 零改动**；只新增（1）本仓库的一个 host 插件行、（2）`$DSH_HOME/.agent-presets/blast-demo` 预设、（3）profile patch 层的一段默认值配置。
> 本节所有"机制"结论都来自本机实际源码（`resources/app.asar` 反解，见 `_agent_probe/asar_x/`）与实测，不做字段猜测。

---

## 1. 本机 DSH 2.0.3 的真实 permission / approval 机制（源码级）

### 1.1 三个旋钮，没有别的

| 包 | 作用 | 本机实际字段 | 取值 |
|---|---|---|---|
| `@deepseek-ai/dsh-sandbox-policy` | 沙箱模式归属（`ctx.sandboxPolicy`） | `mode` | `read-only` / `workspace-write` / `danger-full-access` |
| | 同上 | `workspaceRoot` | `process.cwd()` |
| `@deepseek-ai/dsh-user-approval` | 审批归属（`ctx.approval`） | `policy` | `ask` / `never` |
| `@deepseek-ai/dsh-permission-presets` | 把上面两个旋钮打包成用户可选预设 | `presets.<name>.{sandbox,approval}` | 本机：`read-only`、`workspace-write`、`danger-full-access` |

**本机实测**（`_agent_probe/dump_config_utf8.yml`，由 DSH 自身 dump 的真实配置）：
`DSH_PERMISSION_MODE ?? 'workspace-write'` → sandbox `workspace-write`，approval `ask`。

### 1.2 没有"命令白名单"这个字段

逐包读过实现（`_agent_probe/asar_x/*.index.js`）：

* `dsh-sandbox-policy`：只有 `mode` + `workspaceRoot`；每会话覆盖是 session log 里的一条 `sandbox/mode` 事件。
* `dsh-user-approval`：只有 `ask` / `never`；grant 只有 `allowed-once`，**没有 allow-always / 规则表 / 撤销**。
* `dsh-permission-presets`：预设 = `{sandbox, approval}` 两元组，仅此而已。
* `dsh-tool-pwsh`：`sandbox_permissions` 升级面只在"沙箱执行器已挂载"时公布；升级必须带 `justification` 并**在执行前**经 `ctx.approval` 拿到 `allowed-once`，否则 fail-closed 不运行。
* `dsh-sandbox-windows-acl`：受 ACL 限制令牌的 Windows 后端；`workspace-write` 只授予"工作区 + 本会话私有 temp"的写权限，并明确记录两条边界：受限进程**无法用管道捕获孙进程输出**（EPERM），`read-only` 下 PowerShell 会退化成 ConstrainedLanguage。

**→ 结论：DSH 2.0.3 的 host 权限栈里不存在"允许某条命令但不允许另一条"的配置。**
"只允许已知执行路径、其余仍需审批"这件事**只能落在 agent 组装层（preset 的行）**，这就是本 Profile 的全部设计依据。

### 1.3 为什么"合法 run 会弹通用 escalation"

`SANDBOX_RUNTIME_DIAGNOSIS.md` 已实测：整条流水线唯一的子进程是 joblib 在 Windows 上探测物理核数时调用的
`powershell.exe`（`capture_output=True` → 管道）。在 ACL 受限令牌下，**受限进程无法用管道捕获孙进程输出**，
于是表现为 `WinError 5`，模型按 `dsh-tool-pwsh` 的指引走同轮次 `sandbox_permissions` 升级 →
弹出通用 escalation 对话框。这与"用户做错了什么"无关，是**受限沙箱 + joblib 探测**的必然结果。

两条正交的解法（本轮两条都做了）：

1. **运行层**：`BLAST_AGENT_SINGLE_PROCESS=1` 让 joblib 直接采用 `LOKY_MAX_CPU_COUNT=1`，探测子进程消失；
2. **组装层**：演示用的 agent 根本不挂 `pwsh`，工程计算走本仓库自己的固定 argv 工具。

---

## 2. Demo Profile 是什么

```
%USERPROFILE%\.dsh\.agent-presets\blast-demo\        ← 由 blast_engineering_ui/tools/install-demo-profile.mjs 安装
├─ agent.cordis.yml                                ← 生成的组装（模板 demo-profile/agent.cordis.template.yml）
└─ preset.yml                                      ← 展示名「BLAST 工程演示」
```

组装只有 4 行（`demo-profile/agent.cordis.template.yml`）：

| 行 | 作用 |
|---|---|
| `@deepseek-ai/dsh-persona` | 工程人格：只用 `blast_engine` 做工程、不估算任何数值、参数改动=新版本、只报真实读数 |
| `@deepseek-ai/dsh-agent-instructions` | 读仓库 `AGENTS.md` |
| `blast_engineering_ui/lib/blast-tools.mjs`（**本仓库的 tool 插件**） | 唯一的执行面：`blast_engine` + `blast_shell` |
| `@deepseek-ai/dsh-skill-filesystem` + `@deepseek-ai/dsh-tool-skill` | 保留 `.dsh/skills/shaft-blast-design` 技能发现 |

**故意不挂**：`dsh-tool-pwsh`、`dsh-tool-bash`、`dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-web`、subagent / workflow。
即：这个 agent 没有通用 PowerShell，也没有通用文件系统工具。

### 2.1 `blast_engine`：工程路径（没有 shell 字符串）

把一组**封闭的操作名**映射成固定 argv，直接 spawn 项目 venv 解释器（不经任何命令解释器）：

```
operation ∈ { doctor, validate_input, run_analysis, task_status, get_result,
              canonical_result, validate_result_consistency, list_tasks,
              generate_report, generate_figures }
argv = [<repo>/.venv/Scripts/python.exe, -m, agent_adapter.cli, <op>, …]
```

* 每个参数先校验：id 必须匹配 `^[A-Za-z0-9_.-]{1,64}$`，五个工程输入必须是**正数**，未知 operation 直接拒绝；
* `run_analysis` 用适配层自己的 background 模式（提交后立刻返回 task_id，真实流水线作为分离 worker 继续跑）；
* 没有任何路径参数来自模型，cwd 固定为仓库根。

### 2.2 `blast_shell`：白名单优先，其余必须审批

```js
允许（无需审批，仍经沙箱执行器 ctx.shell 运行）：
  <…>\agent_adapter\blast.cmd <已知子命令> [参数]
  <repo>\.venv\Scripts\python.exe -m agent_adapter.cli <已知子命令> [参数]

其余：ctx.approval.request({ toolName, reason, signal }) → 仅 allowed-once 才执行，
      没有审批通道时 fail-closed（不运行）。
```

白名单是**整条命令的形状匹配**（正则 + 已知子命令表 + venv 解释器校验），不是子串匹配。
`blast_engineering_ui/tools/demo-profile-test.mjs` 逐条验证了这些近似命中会被拒绝：
`;` 串接、`>` 重定向、`|` 管道、任意 cmdlet、未知子命令、PATH 里的 python、外来 python、`Get-ChildItem C:\`。

---

## 3. `BLAST_AGENT_SINGLE_PROCESS=1` 真的传到算数值的进程了吗

### 3.1 传法（两层，都不依赖"继承环境"这种偶然）

1. **工具层显式注入**（`lib/blast-tools.mjs::computeEnv`）：每个 `blast_engine` / `blast_shell` 调用都把
   `BLAST_AGENT_SINGLE_PROCESS=1`、`BLAST_AGENT_ORIGIN=dsh-demo-profile`、`PYTHONPATH`、`PYTHONIOENCODING`
   作为 `spawn(..., env)` 的**显式值**传下去；
2. **适配层在自己进程内落地**（`agent_adapter/config.py::apply_single_process_env`，import 时执行）：
   因为 `LOKY_MAX_CPU_COUNT` 是 joblib 第一次 `Parallel` 时才读、`OMP_NUM_THREADS` 是 OpenMP 首次初始化时才读，
   前台 in-process 流水线光靠"给子进程设环境变量"是管不到的 —— 所以适配层在 import 时把 5 个变量写进
   `os.environ`（已显式设过的不覆盖），同时 `worker_env()` 继续给后台 worker 子进程用。

### 3.2 记录（provenance 是"进程自己看到的"，不是调用方自称的）

| 证据 | 内容 |
|---|---|
| `agent_adapter/workspace/tasks/<task>/RUNTIME_PROVENANCE.json` | 该计算进程的 pid/parent/driver/python/cwd/argv、`origin`、`single_process.enabled`、`declared_vars`、`applied_by_adapter_import`、`effective_in_this_process` |
| `agent_adapter/workspace/logs/runtime_provenance.jsonl` | 每任务一行，追加式 |
| `STATUS.json` 的 `runtime_provenance` 字段 + `task-status` 的 `results.runtime_provenance` | 轮询即可看到 |
| `blast_engineering_ui/.cache/runtime_provenance.jsonl` | **工具侧**记录它到底传了什么（argv/cwd/env），与上面互为对照 |

`GET /blast-engineering-api/runtime?task=<id>` 也把这条记录暴露给 UI（默认折叠的 Technical Trace 才显示）。

### 3.3 实测

* 离线自检 `blast_engineering_ui/tools/demo-profile-test.mjs`：31/31 通过，其中
  `blast_engine operation=doctor` 真的起了一次适配层 CLI，并把 `.cache/runtime_provenance.jsonl` 追加了一条。
* 真实流水线证据：`_stage_probe/engine_run_provenance.mjs`（在真实 case 上跑一次完整 `run_analysis`）
  → `_stage_probe/engine_run_provenance.json`：`origin=dsh-demo-profile`、
  `single_process.enabled=true`、5 个变量在**计算进程内**都等于 `1/0`，且 `STATUS.json` 走到 `phase=done`。
* 本轮 UI 验收期间，同一条 adaptor 证据链在 `agent_adapter/workspace/logs/runtime_provenance.jsonl`
  与各任务的 `STATUS.json` 中持续累积。

> 工程后果照实记录：开启 `BLAST_AGENT_SINGLE_PROCESS=1` 后，`peripheral_spacing_mm` 的**未取整区间端点**
> 相对"多线程基线"有 ≤1 ULP（1.7e-13）差异，决策级数值（孔数、装药量、间距点值、状态、QC、几何、报告）逐字节相同；
> 且单线程配置自身**逐字节可复现**，基线自身反而不可复现（`SANDBOX_RUNTIME_DIAGNOSIS.md` §E）。

---

## 4. 安装 / 启用 / 回滚

```powershell
# 安装 preset（幂等；--set-default 会先备份 settings.yaml）
node blast_engineering_ui\tools\install-demo-profile.mjs --install --set-default
node blast_engineering_ui\tools\install-demo-profile.mjs --status

# 让 profile 的部署默认值也指向它（新会话默认就走 Demo Profile）
#   %USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml 里的一段：
- id: agent-presets
  config:
    default: blast-demo

# 回滚（任一步都独立生效）
node blast_engineering_ui\tools\install-demo-profile.mjs --uninstall   # 删 preset 目录、恢复 settings 备份
# 再把 cordis.patch.yml 里的 agent-presets 段删掉，重启 DSH Desktop
```

会话内还可在输入框左侧的 **Agent 预设选择器**里切换（本机实测显示为「BLAST 工程演示」）。

---

## 5. 实测结果（demo-profile-test.mjs，31/31）

```
PASS  plugin exports the cordis contract — name=blast-demo-tools inject=["tools","systemPrompt"]
PASS  two tools registered (and only two) — blast_engine, blast_shell
PASS  blast_engine operation set is closed and explicit — 10 operations
PASS  blast_engine exposes the project's own five inputs + case_id
PASS  system prompt section registered
PASS  both tools declare an output schema
PASS  allowlist accepts/refuses …            （10 条：2 条允许 + 8 条近似命中全部拒绝）
PASS  off-allowlist without an approval channel → fail closed, nothing runs
PASS  off-allowlist + approval rejected → nothing runs
PASS  off-allowlist + allowed-once → runs exactly once
PASS  allowlisted command needs no approval
PASS  allowlisted command still runs inside the session sandbox policy — workspace-write
PASS  allowlisted command carries the runtime env for the compute process
PASS  blast_engine rejects a malformed task id / unknown operation / non-positive value
PASS  blast_engine operation=doctor really ran the project adapter CLI
PASS  the adapter's own JSON envelope is returned verbatim
PASS  runtime provenance appended + records the interpreter and env it passed
PASS  preset template renders with no unresolved placeholder
PASS  preset mounts our tool plugin and no general shell/fs tool
```

---

## 6. 已知限制（如实）

| # | 限制 | 说明 |
|---|---|---|
| 1 | `blast_engine` 由 **host 插件进程**直接 spawn，不经过 `ctx.shell` 沙箱 | 这是刻意的：argv 封闭、无 shell、每参数校验，可执行面只有项目自己的适配层 CLI。它**不**是"任意执行"，但也**不**受 ACL 沙箱约束 —— 若将来要收紧，应给 `ctx.shell` 增加"固定 argv、无命令解释器"的执行面（本轮未改 Core）。 |
| 2 | 演示 preset 里没有通用文件系统工具 | 模型看数据一律经 `blast_engine` 的返回信封；这对"最小权限"是有利的，代价是它不能自由翻仓库（也不应该）。 |
| 3 | 白名单命令**仍需**通过沙箱执行器 | 白名单只免"审批"，不放宽"沙箱"；若某条命令在 `workspace-write` 下被 ACL 拒绝，工具会如实回报 `denied`，不会偷偷升级。 |
| 4 | 新会话的 preset 选择面属于官方侧栏 | 本 POC 的 Context Sidebar 遮蔽了官方侧栏（round 1 的既有设计），因此"新建会话/切换会话/选预设"入口在官方侧栏里 —— 见 `VOICE_FIRST_WORKSPACE_POC.md` §6 的已知问题与绕行方式。 |
