# AGENT_ADAPTER_README — 把本系统接入 DeepSeek Harness（Phase 1 MVP）

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。
> 另注：确定性核心流水线（`51_one_click_end_to_end/`）与项目级 Skill（`.dsh/skills/shaft-blast-design/`）不属本次公开范围，详见 `PUBLIC_RELEASE_AUDIT.md`。

> 一句话：**现有专业软件当"手和工具"，DeepSeek Harness 当"大脑与工作台"。**
> 本适配层只做搬运与整形，不含任何工程算法，也没有修改任何既有生产代码。

---

## 1. 我做了什么（变更清单）

**仅新增**（既有文件 0 修改）：

```
AGENTIZATION_ARCHITECTURE.md                 # 架构审计与迁移路线（A–H 全章节）
AGENTS.md                                    # 工作区 Agent 说明（DSH 自动读取）
.gitignore                                   # 仅忽略适配层运行产物
.dsh/skills/shaft-blast-design/SKILL.md      # 项目级 Skill（DSH rank 100，自动发现）
.dsh/skills/shaft-blast-design/references/   # 输入合同 / 输出包字典 / 工具参考
agent_adapter/blast.cmd                      # 启动器（固定 venv 解释器，不依赖 PATH）
agent_adapter/*.py  services/*.py            # 适配层（CLI + 11 个工具）
agent_adapter/canonical.py                   # Canonical Result Contract（Phase 1.6）
agent_adapter/render_cues.py                 # 确定性展示层（Phase 1.6）
agent_adapter/consistency.py                 # 一致性校验器（Phase 1.6）
agent_adapter/tests/run_acceptance.py        # 可重复验收脚本（--full = 27 项）
agent_adapter/schemas/tool_catalog.json      # 工具目录（Phase 2 MCP 复用）
```

Phase 1.6 另新增三份文档：`RESULT_CONTRACT_AUDIT.md`（字段溯源审计）、
`PHASE1_6_RESULT_CONTRACT.md`（本轮结论）、`SANDBOX_RUNTIME_DIAGNOSIS.md`（沙箱/joblib 诊断）。

**未修改**：`51_one_click_end_to_end/`、`17_/23_/43_/47_/49_/50_/53_/55_/PREBLAST_*`、
`52_gui_v1/`、`56_/57_` 的任何文件；DSH 安装目录与其配置文件也未被改动。

## 2. 怎么用（三步）

### 步骤 1 · 打开工作区

启动 **DSH Desktop**，把工作区设为仓库根：

```
<REPO_ROOT>
```

DSH 会自动发现 `.dsh/skills/shaft-blast-design`（项目级 skill，rank 100，热更新）。

**发现机制说明（读 DSH 源码确认）**：`@deepseek-ai/dsh-skill-filesystem` 的 `findProjectRoot()` 从 cwd
逐级向上，对 `<dir>/.git` 只做**存在性探测**；本仓库根存在 `.git`（空目录）→ 项目根 = 本仓库根
→ skill 根 = `<repo>/.dsh/skills` ✅。

**稳健措施（仓库外，可一键移除）**：另建了用户级目录联接，保证即使项目根被解析到父目录也能找到：

```
%USERPROFILE%\.dsh\skills\shaft-blast-design  ──▶  <repo>\.dsh\skills\shaft-blast-design
```

> 注意：本机的 `dsh` CLI（`dsh --profile … <任务>`）**无法启动任何 profile**（报
> `failed to start packaged dsh: … loader entries failed to apply`，在仓库外的 `C:\` 下同样失败，
> 属 Desktop-only 安装的既有限制）。因此请使用 **DSH Desktop 桌面程序**，不要尝试用 CLI 跑任务。
> `dsh --dump-config` 仍可用于查看组合树。


### 步骤 2 · 直接用自然语言提问

例如：

```
按这些参数帮我生成完整方案：井筒深度 500 m，井筒直径 6.0 m，普氏系数 f=8，
计划循环进尺 3500 mm，炮孔直径 55 mm，炮孔深度 4000 mm。案例编号用 AGENT_DEMO_1。
```

Agent 会：`validate-input` → `run-analysis`（后台）→ `task-status` 轮询 →
`get-result` →（按需）`generate-figures` / `generate-report` → 在对话里给出
状态、指标表、工程警告与**真实文件路径**（图片、DXF、报告）。

继续多轮：

```
把井筒直径改成 5.0 再算一次。
和刚才那个方案比较一下。
为什么推荐这个方案？
帮我生成报告。
```

### 步骤 3 · 需要时手动验证（不依赖 Harness）

```powershell
# 一键验收（16 项，含完整流水线；走与 Agent 完全相同的 CLI 入口）
python agent_adapter\tests\run_acceptance.py            # 快速 9 项（不跑重算）
python agent_adapter\tests\run_acceptance.py --full     # 16 项（约 3 分钟）

# 或逐条手工调用（推荐用 blast.cmd：它固定 .venv 解释器，不依赖 PATH）
agent_adapter\blast.cmd doctor
agent_adapter\blast.cmd validate-input --input-file req.json
agent_adapter\blast.cmd run-analysis  --input-file req.json      # 后台，秒级返回
agent_adapter\blast.cmd task-status   --task-id T...
agent_adapter\blast.cmd get-result    --task-id T...
agent_adapter\blast.cmd get-result    --task-id T... --section render     # 第一屏展示契约
agent_adapter\blast.cmd canonical-result --task-id T...                   # Canonical 契约
agent_adapter\blast.cmd validate-result-consistency --task-id T...        # 一致性自检
agent_adapter\blast.cmd get-result    --case-id P0535            # 历史案例只读
agent_adapter\blast.cmd compare-results --task-a T1 --task-b T2
agent_adapter\blast.cmd generate-figures --task-id T... --targets plan,3d,charge
agent_adapter\blast.cmd generate-report  --task-id T...
```

> `run-analysis` 一次约 60~180 秒，因此**默认后台执行**；这正是为规避 Harness
> `pwsh` 工具约 60 秒默认超时而设计的。

## 3. 数据与目录

```
agent_adapter/workspace/
├── index.json                         # 任务索引（list-tasks 数据源）
├── logs/<task_id>.log                 # 后台任务输出
├── tasks/<task_id>/
│   ├── REQUEST.json / REQUEST_RAW.json / INPUT.json
│   ├── STATUS.json                    # queued | running | done | failed（含 package_dir）
│   ├── AGENT_RESULT.json              # 生产流水线返回的完整 result
│   ├── envelope.json                  # 最近一次工具信封
│   └── output/<case_id>/              # ← 真实输出包（26 个文件）
├── figures/<case>_<stamp>/            # generate-figures 输出（不覆盖原包）
└── reports/<case>_<stamp>/            # 历史案例报告输出
```

- Agent 运行**不会污染** `51_one_click_end_to_end/outputs/`（冻结证据库，只读）。
- 可用环境变量 `BLAST_AGENT_WORKSPACE` 把运行区改到别处。

## 4. 环境变量（可选）

| 变量 | 默认 | 作用 |
|---|---|---|
| `BLAST_AGENT_WORKSPACE` | `agent_adapter/workspace` | 适配层运行区 |
| `BLAST_AGENT_PYTHON` | 当前解释器 | 后台 worker 使用的 Python |
| `BLAST_AGENT_USE_ML` | `1` | `0` 则装药推荐直接走 STATISTICAL_CBR |
| `BLAST_AGENT_USE_6E` | `0` | `1` 启用 Model6E（生产不用） |
| `BLAST_AGENT_TIMEOUT_S` | `3600` | 单次流水线最长等待 |
| `BLAST_AGENT_LIST_LIMIT` | `20` | `list-tasks` 默认条数 |
| `BLAST_AGENT_SINGLE_PROCESS` | `0`（关） | 置 `1` 时 worker 以单进程/单线程运行数值库：消除 joblib 的 Windows 核数探测子进程，结果逐字节可复现；代价是区间端点相对基线有 ≤1 ULP 差异（详见 `SANDBOX_RUNTIME_DIAGNOSIS.md`） |

## 5. 验收结果（本次实测）

**一键验收：`python agent_adapter/tests/run_acceptance.py --full` → `ADAPTER_ACCEPTANCE = PASS (16/16)`**

| 验收项 | 结果 |
|---|---|
| 既有生产流水线未被破坏 | ✅ `run_one_click_design.py` 独立跑通（6.0 m 案例 52.6 s / 25 文件）；对既有生产目录 `git status` 改动为 **0** |
| `doctor` 自检 | ✅ checks 9/9（Core 入口 / numpy / matplotlib / ezdxf / workspace 可写 / Skill 存在 / 校验冒烟） |
| `validate-input`（合法输入） | ✅ `valid=true`，1.3~1.6 s |
| `validate-input`（非法输入） | ✅ Core 原生错误 + `BLOCKED_BY_HARD_CONSTRAINT` |
| `run-analysis`（后台） | ✅ 0.78 s 返回 `task_id`；worker 正常完成（冷启动约 42~75 s，热态约 42 s） |
| `task-status` 轮询 | ✅ 实时 `elapsed_s`；`queued → running → done`，顶层 `status=CANDIDATE_REFERENCE` |
| `get-result` | ✅ 真实指标（64 孔 / 总装药 156.184 kg / gap 17.7% / 置信度 LOW）+ 25 个产物路径；信封约 14 KB |
| `get-result --case-id P0535` | ✅ `source=frozen`，只读历史证据，`status=RECOMMENDED_WITH_REVIEW` |
| `get-result --section explain` | ✅ 复用 52_gui_v1 只读追溯层（约 43 KB） |
| `compare-results` | ✅ 任务 vs 历史案例、任务 vs 任务均正确（`total_holes 64 → 58, delta -6`） |
| `generate-figures` | ✅ 8 个真实文件（`FINAL_PLAN.{png,pdf,svg,dxf}`、`FINAL_3D_PREVIEW.png`、`CHARGE_STRUCTURE.{png,pdf,svg}`） |
| `generate-report` | ✅ 输出 `ONE_CLICK_REPORT.md`（>500 B）；对历史冻结案例**拒绝**重算并返回既有报告路径 |
| `list-tasks` | ✅ 任务索引与 phase 同步 |
| 改参重跑（直径 6.0 → 5.0 + `--parent-task-id`） | ✅ 新 task 成功，血缘已记录 |


## 6. 回滚方式（恢复到"没有 Agent"的状态）

本适配层**完全外挂**，回滚只是删除新增文件：

```powershell
Remove-Item -Recurse -Force agent_adapter
Remove-Item -Recurse -Force .dsh
Remove-Item -Force AGENTIZATION_ARCHITECTURE.md, AGENT_ADAPTER_README.md, AGENTS.md, .gitignore
# 仓库外的用户级 skill 联接（可选，一并清理）：
cmd /c rmdir "%USERPROFILE%\.dsh\skills\shaft-blast-design"
```

删除后 `python 51_one_click_end_to_end/run_one_click_design.py …` 与 `python 52_gui_v1/app.py`
的行为与改动前完全一致（因为从未改动它们）。Harness 侧无需回滚 —— Phase 1 **没有修改任何 DSH 配置**。

## 7. Phase 2 预留：升级为原生工具（MCP）

Phase 1 用"Skill + 内置 pwsh 工具"已能完整闭环；Phase 2 可把同样 8 个命令升级为带 JSON Schema
的一等工具（`mcp__blast__run_project_analysis` 等）。做法（**尚未执行**）：

1. 新增 `agent_adapter/mcp_server.py`（`pip install mcp` 已确认网络可达），
   工具定义直接复用 `agent_adapter/schemas/tool_catalog.json`；
2. 在 `~/.dsh/profiles/desktop/cordis.patch.yml`（顶层必须是 YAML 数组）追加：

```yaml
- insert:
    - id: mcp-blast-design
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: blast
        transport: stdio
        command: '<REPO_ROOT>\.venv\Scripts\python.exe'
        args: ['-m', 'agent_adapter.mcp_server']
        cwd: '<REPO_ROOT>'
        toolCallTimeoutMs: 600000
        failOnStartupError: false
```

3. 回滚 = 删除该数组项并重启 DSH（该 patch 层支持热重载）。

> 该 patch 是 **profile 级（全机生效）**；若不愿影响其它工作区，可为本项目单独建一个 profile 再在其中 `insert`。

## 8. 已知边界与后续计划

- **不做**独立"优化器"工具：项目中没有该入口，候选与区间由 Phase 6 / Phase 7D 在流水线内产生；
  多方案需求用"改参重跑 + `compare-results`"实现。
- **不做**常驻服务：每次 `run-analysis` 都是一次干净的子进程，退出即释放内存；代价是约 1 分钟/次。
- **沙箱**：DSH 默认 `workspace-write`（可写本仓库）。若环境限制子进程或临时目录，
  可在 DSH 侧设置 `DSH_PERMISSION_MODE=danger-full-access`（仅在确认必要时）。
- **Phase 3 候选**：自动参数寻优（多方案扫描 + 目标函数，仍只调用生产流水线）、
  PREBLAST 后评价接入、PINN 物理响应接入、历史案例知识库检索、多用户/云端部署。

