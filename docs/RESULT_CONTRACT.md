# PHASE1_6_RESULT_CONTRACT.md

> **公开源码版说明**：本文件原为内部交付 / 真机验收记录。发布时做了两件事——(1) 剥离主机名、用户名与绝对路径等本机信息（替换规则见根目录 `PUBLIC_RELEASE_AUDIT.md`）；(2) 正文中形如 `docs/screenshots/**` 的图片属内部验收图集，未随公开版发布，公开版只保留 `docs/assets/` 下的精选图集。
> 另注：确定性核心流水线（`51_one_click_end_to_end/`）与项目级 Skill（`.dsh/skills/shaft-blast-design/`）不属本次公开范围，详见 `PUBLIC_RELEASE_AUDIT.md`。

> **Phase 1.6 — Result Contract Consistency Hardening** 结论文档
> 范围：Core → Adapter → Report → Agent 四层之间的**数据语义统一**
> 原则：不改核心工程算法、不改真实计算结果、不为消除 warning 而隐藏 warning
> 日期：2026-09-17 ｜ 验收：`python agent_adapter\tests\run_acceptance.py --full` → **PASS (27/27)**

---

## A. 本轮交付物

| 文件 | 类型 | 作用 |
|---|---|---|
| `RESULT_CONTRACT_AUDIT.md` | 文档 | §一 审计：两个真实任务的**逐字段来源** + 三处同名不同义的源码级判定 + 旧信封体积构成 |
| `SANDBOX_RUNTIME_DIAGNOSIS.md` | 文档 | §八 诊断：joblib/loky 实测、受限友好配置、A/B 一致性测试 |
| `PHASE1_6_RESULT_CONTRACT.md` | 文档 | 本文档（结论与三分类） |
| `agent_adapter/canonical.py` | 新增 | **Canonical Result Contract 构建器**（`canonical_result.v1`，字段级 provenance） |
| `agent_adapter/render_cues.py` | 新增 | 确定性展示层（状态措辞闸门 / must_state / ≤8 指标 / 提示 / 交付物 / 详细层） |
| `agent_adapter/consistency.py` | 新增 | **Result Consistency Validator**（17 项检查，纯只读） |
| `agent_adapter/services/contract_service.py` | 新增 | 两个新工具的服务层 |
| `agent_adapter/cli.py` | 改（新增命令） | `canonical-result`、`validate-result-consistency`；`get-result --section` 增加 `canonical`/`render` |
| `agent_adapter/config.py` | 改（新增开关） | `BLAST_AGENT_SINGLE_PROCESS`（§8，默认关） |
| `agent_adapter/services/analysis_service.py` | 改 | 运行后落盘 `CANONICAL_RESULT.json`；worker 环境注入 |
| `agent_adapter/services/result_service.py` | 改 | 信封内含 `results.canonical` + `results.render`；compare 增加 `canonical_diff` |
| `agent_adapter/taskstore.py` | 改 | `write_json` / `read_task_json` |
| `agent_adapter/schemas/tool_catalog.json` | 改 | 新增两个工具定义（供 Phase 2 MCP 复用） |
| `.dsh/skills/shaft-blast-design/SKILL.md` | 改 | 新工具流程 + **§5.5 语义陷阱** + **§6 确定性汇报格式（硬规则）** |
| `.dsh/skills/shaft-blast-design/references/result-contract.md` | 新增 | canonical 字段字典（Agent 查表用） |
| `agent_adapter/tests/run_acceptance.py` | 改 | 新增 "Phase 1.6 契约阶段"（11 项） |

**未修改**：`51_one_click_end_to_end/**`、`17_/23_/43_/47_/49_/50_/53_/55_/PREBLAST_*`、
`52_gui_v1/**`、`56_/57_`，以及任何 DSH 安装/配置文件。

---

## B. 问题清单与处置（三类，必须分清）

### B.1 已"修复"的问题（= 由 Adapter 层消除的表达矛盾，Core 未动）

| # | 问题 | 处置 | 验证 |
|---|---|---|---|
| 1 | OOD 语义冲突：报告同时出现 `ood_status=IN_DISTRIBUTION` 与 `OUT_OF_DOMAIN`；Adapter 却只给一个 `ood.is_ood` | canonical 拆为 **`ood.model_distribution`**（模型输入分布，← `flat.ood_status`）与 **`ood.evidence_domain`**（历史证据域，← `JOINT_CALIBRATION.ood`），各自带 `semantics` 与 `checks` 明细，并给出 `reconciliation.explanation` 说明二者可同时为真 | Validator `ood_semantics_separated`（A/B 均 PASS）；展示层两句固定措辞 |
| 2 | 复核状态矛盾：报告 `Phase6 人工复核: None` 与 `review_required=YES` 并存，`None` 可能被读成"无需复核" | canonical 拆为 **`review.phase6_manual_review`**（Phase6 侧，含 `reason_available=false` + 显式 `reason_unavailable_explanation` + `cause_flags`）与 **`review.final_review`**（最终侧 `review_required`/`review_flags`），顶层再给统一 `review.required` 与 `required_sources` | Validator `review_required_consistency` + `report_phase6_review_literal_none` |
| 3 | 报告/JSON 出现**同一个概念两种方法命名**（`STATISTICAL+CBR+ML` vs `HYBRID_ML_CBR`） | canonical 同时保留 `method_per_group`（`method_summary` 口径）与 `method_used/requested/fallback`（`_ml` 口径），并在文档与 Skill 中说明同义 | 文档 §C.4 + Skill §5.5 |
| 4 | Agent 回答"开发日志式"，用户级信息被明细淹没 | 新增 `results.render` **确定性展示契约**；Skill §6 给出强制格式与**禁止用语**（`prohibited_claims_cn`） | 验收项"展示层确定性口径"；Skill 硬规则 1-5 |
| 5 | 状态用词可能被误读为"系统已正式批准" | `render.can_be_called_approved` 仅对 `AUTO_RECOMMENDED` 为 true；其余状态给出 `approval_state_cn`（"未获系统正式批准…"）与禁止用语清单 | 验收项"展示层确定性口径"（A/B 均 FAIL 阈值检查 → PASS） |
| 6 | 结果一致性无人自检 | 新增 `validate-result-consistency`（17 项检查，纯只读，含报告↔canonical 一致、产物存在、父子任务、对比引用） | 验收项（A/B 均 PASS，0 error） |
| 7 | 关键结论口径可能漂移（两处 confidence / 两处 gap） | canonical 明确"权威源"：`confidence.overall ← conf.overall`；`mass_balance` 同时给出 `joint_gap` 与 `mass_balance_error` 并置 `gap_agree` | Validator `confidence_consistency`、`mass_balance_gap_consistency` |

> 这些"修复"**全部发生在 Adapter 层**：Core 的 JSON 与 `ONE_CLICK_REPORT.md` 一字未改，
> 因此既有的 CLI/GUI 行为、历史证据库、冻结清单均不受影响。

### B.2 只是"命名澄清"的问题（Core 逻辑本来就对，只是词不达意）

| # | 现象 | 澄清结论 | 依据 |
|---|---|---|---|
| 1 | `severity = OOD` 而 gap 仅 7.26%（阈值 pass=0.25） | `severity` 在此情形**不表达 gap 等级**（`classify_severity` 在 OOD 时短路返回 "OOD"）。canonical 同时给出 `gap`、`thresholds` 与 `severity_semantics`，并置 `gap_band_visible_in_severity=false` | `mass_balance_diagnostics.py:47-48` |
| 2 | `ood.is_ood=true` 但 `density_ood=false`、`n_neighbors_within_p95=862` | 同一 `is_ood` 由三项 OR 构成，"无同名历史记录"即可为真；特征范围与 kNN 密度均无异常。canonical 把三项拆到 `checks.*` | `ood_policy.py:50-86` |
| 3 | `FINAL_STATUS.detail.confidence` 与 `conf.overall` 两处 | 前者是 Core 在 CANDIDATE 分支的**固定字面量**，不是独立证据；canonical 标为 `core_final_status_confidence` 并注明权威源 | `one_click_status.py:91` |
| 4 | 报告第 7 节 `ood_status` 与第 8 节 `OUT_OF_DOMAIN` 并排 | 两个不同概念（同 §B.1-1），属**措辞**问题 | `confidence_engine.py` vs `ood_policy.py` |
| 5 | `joins.status`（如 `GEOMETRY_PASS_CHARGE_REVIEW`）与 `severity` 并列 | 分别属于"联合校准状态机"与"质量平衡严重度（可被 OOD 覆盖）"两个维度 | `geometry_charge_calibrator.py` |

### B.3 仍然属于 Core 的真实限制（本轮**不修**，只登记 + 暴露 warning）

| id | 限制 | 位置 | 影响 | 本轮处置 |
|---|---|---|---|---|
| `PHASE6_MANUAL_REVIEW_REASON_NOT_WRITTEN_IN_PRODUCTION` | 生产路径（`use_6e=False`）不写 `flat.manual_review_reason` | `recommend_single_case.py:151`（在 `if self.e6 is not None` 内） | 报告渲染出字面量 `None`，易被误读为"无需复核" | canonical 置 `reason_available=false` + 解释；Validator 出 warning；Skill 禁止照抄 None |
| `FINAL_STATUS_CONFIDENCE_IS_LITERAL_IN_CANDIDATE_BRANCH` | CANDIDATE 分支硬编码 `confidence:"LOW"`、`review_required:True`；其他分支不写这两个键 | `one_click_status.py:91` | 不能从 FINAL_STATUS 反推真实置信来源 | canonical 以 `conf.overall` 为权威源并标注两者 |
| `SEVERITY_OOD_OVERRIDES_GAP_BAND` | OOD 时 severity 短路，丢失 gap 分级 | `mass_balance_diagnostics.py:47` | 单看 severity 会误判质量平衡 | canonical 给出 gap+thresholds+语义说明 |
| `TWO_MEANINGS_OF_OOD_SHARE_ONE_WORD` | 两个 OOD 共用 "OOD/OUT_OF_DOMAIN" 字样 | `confidence_engine.py:33` / `ood_policy.py:44` | 跨节阅读易判为矛盾 | canonical 命名分离；本轮不改 Core（与 `52_gui_v1/explainability/OOD_STATUS_SEMANTICS_AUDIT.md` 既有结论一致） |
| `REPORT_CONTAINS_LITERAL_NONE_IN_MANUAL_REVIEW_LINE` | 报告模板第 8 节输出 `Phase6 人工复核: None` | `one_click_report.py` | 用户直接读报告会困惑 | Validator 检测并 warning；Agent 汇报以 canonical 为准 |
| （§8）`EXTRA_TREES_PREDICT_THREAD_ORDER_FLOAT_NONDETERMINISM` | `peripheral_spacing_mm` 的 ABS_CONFORMAL 区间端点 = 未取整点预测，来自 `n_jobs=-1` 的 ExtraTrees → 线程求和顺序导致末位抖动 | 模型 + `core/ml_predictor.py:32` | 同输入两次运行区间端点可差 1 ULP（1.7e-13 相对） | 不修模型；提供可选单进程配置（默认关），见 `SANDBOX_RUNTIME_DIAGNOSIS.md` |

---

## C. Canonical Result Contract 概览

新增"Adapter 层唯一标准解释"，**不替代** Core 原始文件（`CANONICAL_RESULT.json` 与
`output/<case_id>/` 并存）。Schema 名：`canonical_result.v1`。

```
identity         task_id / case_id / parent_task_id / source(task|frozen) / out_dir / core_files_present
input            normalized + units
status           final / final_cn(l10n) / level / reason / reason_cn / engineer_adjustable
confidence       overall(=conf.overall,权威) / per_target(+CN) / core_final_status_confidence / consistent
evidence         cbr_neighbors / rule_warning_* / mass_balance(+gap_agree) / thresholds(运行期读 Core)
ood              model_distribution{status,is_out,semantics,provenance}
                 evidence_domain{is_out,reasons,checks{no_historical_record,feature_range_violations,
                                  knn_density_ood,knn_detail},policy,semantics}
                 reconciliation{both_true,explanation} + provenance_note
review           required + required_sources + reasons(+CN)
                 final_review{required,required_effective,flags(+CN),semantics}
                 phase6_manual_review{required,reason,reason_available,cause_flags(+CN),
                                      reason_unavailable_explanation,semantics}
metrics          design / holes(含 sum_of_parts、holes_len) / charge(含两种方法口径)
quality_control  unified_qc / all_yes / joint_calibration{status,severity,gap,severity_semantics,
                                                           gap_band_visible_in_severity}
warnings         [{kind,text,text_cn}]（仅 Core 原文）
artifacts        [{kind,kind_cn,name,path,bytes}]
limitations      [5 条 Core 真实限制]
provenance       files（canonical→Core 文件映射）+ derived_only（哪些字段是纯说明性文字）
```

**每段都带 provenance**：`provenance.files` 给出文件映射，各段内联 `provenance` 给出
"canonical 路径 ← Core 文件:JSON 路径"；`derived_only` 明确列出**仅说明性**的派生字段
（语义解释文字），保证"数值零加工"这一点可被机器检查。

配套 **确定性展示层**（`results.render`）：
`headline_cn` / `approval_state_cn` / `can_be_called_approved` / `prohibited_claims_cn` /
`must_state[5]` / `core_metrics[≤8]` / `engineering_notices` / `deliverables` /
`detail_layer` / `layout_rule_cn`。

---

## D. Result Consistency Validator 检查项（17 项，纯只读）

| # | 检查 | 类别 | 判据 |
|---|---|---|---|
| 1 | `canonical_shape` | error | 必需段齐全、schema 正确 |
| 2 | `ood_semantics_separated` | error/warn | 两概念必须同时存在；同时为真时降为 warning + 解释 |
| 3 | `holes_sum_consistency` | error | `total == cut+relief+aux+peripheral+bottom` 且 `== len(holes)` |
| 4 | `mass_balance_gap_consistency` | error | `joint.gap == mass_balance.mass_balance_error` |
| 5 | `final_status_vs_flags` | error/warn | 四级状态与 `review_flags`/`ood.reasons` 按 Core 决策树自洽 |
| 6 | `review_required_consistency` | error/warn | `required` vs flags 一致；`reason_available=false` → warning |
| 7 | `confidence_consistency` | error | `conf.overall` 与 `FINAL_STATUS.detail.confidence` 一致 |
| 8 | `confidence_source_semantics` | warn | 提示 CANDIDATE 分支为字面量 |
| 9 | `unified_qc_vs_status` | error | AUTO_RECOMMENDED 不得有 QC 未通过项 |
| 10 | `joint_severity_semantics` | warn | `severity=OOD` 时提示 gap 分级被短路 |
| 11 | `charge_method_logged` | error | QC 声明已记录则 `method_used` 必须存在 |
| 12 | `artifacts_exist` | error | 每个 artifact 路径存在且非空 |
| 13 | `report_vs_canonical` | error | 报告的状态/置信度/ood_status/孔数/总装药量与 canonical 一致 |
| 14 | `report_phase6_review_literal_none` | warn | 报告 `人工复核: None` 的显式标注 |
| 15 | `report_severity_ood_unsplit` | warn | 报告 severity=OOD 的显式标注 |
| 16 | `report_two_ood_concepts_unsplit` | warn | 报告两处 OOD 并排的显式标注 |
| 17 | `task_index_chain` | error/warn | `parent_task_id` 存在、case_id 一致、`package_dir` 存在 |
| 附 | `compare_reference` | error/warn | 对比两侧 case 自洽且不指向同一目录（传 `--compare-*` 时） |

输出：`{valid, errors[], warnings[{check,detail,core_limitation}], checks{}, counts, target}`。
`valid=true` ⟺ `errors` 为空；**语义无法自动判定的一律 warning，绝不自动改 Core**。

---

## E. Agent 展示分层（§6/§7）落地

| 层 | 内容 | 来源 |
|---|---|---|
| 第一屏 · 方案状态 | `headline_cn` + `approval_state_cn`（是否"已批准"的措辞闸门） | `render` |
| 第一屏 · 必答项 | 置信度 / 需要人工复核 / 证据域状态 / 模型输入分布（**四项均不得省略**） | `render.must_state` |
| 第一屏 · 核心指标 | ≤8 项（总数/掏槽/辅助/周边/孔距/q_design/总装药量/设计直径） | `render.core_metrics` |
| 第一屏 · 工程提示 | 复核标记 + 影响说明（真正影响采用的项） | `render.engineering_notices` |
| 第一屏 · 交付物 | 图纸 / 3D / 装药结构 / 报告（绝对路径） | `render.deliverables` |
| 详细层 | Task ID / parent / 装药方法（requested/used/fallback/分组）/ severity+gap+阈值 / 完整参数 / JSON 指针 / limitations | `render.detail_layer` |

**状态用词（deterministic）**：

| FINAL_STATUS | 用户级表述 | 可称"已批准"？ |
|---|---|---|
| `AUTO_RECOMMENDED` | 自动推荐方案（系统默认方案，已通过全部工程校验） | 可以 |
| `RECOMMENDED_WITH_REVIEW` | 推荐方案 —— 建议工程师复核后采用（尚未获得正式批准） | 不可以 |
| `CANDIDATE_REFERENCE` | 候选参考方案 —— 需工程师调整后采用（**未获系统正式批准**） | 不可以 |
| `BLOCKED_BY_HARD_CONSTRAINT` | 硬约束阻止 —— 未生成方案 | 不可以 |

禁止用语（非批准状态下）：系统已正式批准 / 已批准 / 可直接采用 / 最终批准方案 / 已通过验收方案。
**数值与结论一律不得隐藏**：LOW 置信度、证据域超域、`review.required=true` 必须出现在第一屏。

---

## F. §8 沙箱运行层（摘要，详见 `SANDBOX_RUNTIME_DIAGNOSIS.md`）

| 问题 | 实测结论 |
|---|---|
| 推理是否真的需要多进程？ | **不需要**：0 次 `apply_async`、0 次建池、0 个 worker、0 个 pipe |
| 整条流水线唯一的子进程 | joblib 在 Windows 上探测物理核数 → `powershell.exe -Command (Get-CimInstance …NumberOfCores)` |
| 等价单进程 inference | 存在：`LOKY_MAX_CPU_COUNT=1` + `JOBLIB_MULTIPROCESSING=0`（可选，Adapter 已支持注入） |
| A/B 一致性 | 决策级数值 100% 相同；**仅** `peripheral_spacing_mm` 未取整区间端点差 1 ULP（1.7e-13） |
| 是否设为默认 | **否**——按既定规则（必须完全一致）保持现状为默认，该配置作为**可选**（`BLAST_AGENT_SINGLE_PROCESS=1`） |
| 附带发现 | 基线**自身不可复现**（A vs A2 = 13/15）；受限友好配置**完全可复现**（B vs B2 = 15/15）且略快（41 s vs 49 s） |

---

## G. 验收（用户 §十 的 8 项 + 回归）

命令：`python agent_adapter\tests\run_acceptance.py --full` → **PASS (27/27)**

| 用户验收项 | 结果 |
|---|---|
| 1. Canonical result 能完整表示两次结果 | **PASS** — 方案 A（直径 6.0）与 B（直径 5.0）均可生成 `canonical_result.v1`，各含 25 个 artifacts、13 个必需段 |
| 2. consistency validator PASS | **PASS** — A：17 checks / 11 pass / 6 warn / **0 fail**；B：17 / 10 / 7 / **0 fail** |
| 3. Report 与 canonical result 一致 | **PASS** — `report_vs_canonical`：状态、置信度、ood_status、孔数（**报告分项和 = 报告总数 = canonical 总数**）、总装药量逐项一致 |
| 4. OOD 不再存在语义矛盾 | **PASS** — 两概念分离且各自带语义；报告层面的并排写法被 Validator 标为**已知 Core 限制** warning |
| 5. review 状态不再存在矛盾 | **PASS** — `review.required=true` 明确；`None` 被显式标注为"字段未产出"，Skill 禁止照抄 None |
| 6. compare-results 不受影响 | **PASS** — 原有 `input_diff`/`metric_diff` 保留（`total_holes 64→58, delta -6`），另增 `canonical_diff`（11 字段，changed=3） |
| 7. Agent 多轮能力不受影响 | **PASS** — 全流程（校验 → 后台计算 → 轮询 → 取结果 → 出图 → 出报告 → 改参重跑 → 对比）27/27 通过 |
| 8. 既有生产 Core 结果不发生变化 | **PASS** — 回归基线 `total_holes=64`、`total_charge=156.184 kg` 与 Phase 1 完全一致；`git status` 对既有生产目录改动 **= 0** |

额外回归（Phase 1 的能力全部保持）：
`doctor` / `validate-input`（合法+非法）/ `get-result`（任务+历史冻结）/ `compare-results`（历史+任务）/
`generate-figures`（含历史案例，不覆盖原包）/ `generate-report`（任务型生成、历史型拒绝重算）/
`list-tasks` / 后台任务与轮询 / `parent_task_id` 台账。

---

## H. 本轮"不要做"清单遵守情况

| 禁止项 | 遵守 |
|---|---|
| MCP / 自研 UI / React / 数据库 / RAG / 多智能体 / Docker / 云部署 | ✅ 全部未做 |
| 修改工程核心算法 | ✅ 未修改（`51_/17_/23_/43_/47_/49_/50_/53_` 零改动） |
| 修改 ML 模型 | ✅ 未修改（连 `n_jobs` 都保持原状；单进程配置仅为**可选环境变量**，默认关） |
| 改变生产结果 | ✅ 未改变（回归基线与 Phase 1 一致） |
| 为了消除 warning 而隐藏 warning | ✅ 反向做法：把 Core 真实限制**显式登记**为 `limitations` + Validator warning，并在 Skill 中要求如实陈述 |

---

## I. 下一步（按要求暂停）

Phase 1.6 已完成，**未进入 Phase 2**（不启动 MCP 化、不做原生工具迁移）。

可选后续（等待你的指令）：
1. **是否启用** `BLAST_AGENT_SINGLE_PROCESS=1`（最小权限运行 + 逐字节可复现），
   代价是区间端点相对基线有 ≤1 ULP 差异；
2. 是否需要在 DSH Desktop 内**人工验收**一次新展示层（第一屏结构是否符合你的预期）；
3. 若确认稳定，再进入 Phase 2（MCP 原生工具化，复用已就绪的
   `agent_adapter/schemas/tool_catalog.json`）。



