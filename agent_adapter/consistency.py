# -*- coding: utf-8 -*-
"""agent_adapter.consistency — Result Consistency Validator（Phase 1.6 §5）。

**纯校验工具：只读、不修改任何结果**（不写输出包、不改 Core、不改 canonical）。

输出契约：
    {
      "valid": bool,                 # 仅当 errors 为空时为 true
      "errors":   [{"check","detail"}],
      "warnings": [{"check","detail","core_limitation"|None}],
      "checks":   {"<name>": {"status":"PASS|FAIL|WARN|SKIP","detail":"..."}}
    }

判定纪律：
  - 只做**能从 Core 定义直接推出**的一致性判定（数值守恒、决策树自洽、引用一致、文件存在）；
  - 语义无法自动判定的一律 `WARN`，并在解释里说明"需人工判断"，绝不自动改 Core；
  - 发现 Core 真实限制时，warning 附 `core_limitation` id，与 canonical.limitations 对应。
"""
from __future__ import annotations

import re
from pathlib import Path

from . import artifacts, canonical as canon, config, engine, render_cues, taskstore


class _Acc:
    """校验累加器。"""

    def __init__(self):
        self.checks: dict = {}
        self.errors: list = []
        self.warnings: list = []

    def ok(self, name, detail=""):
        self.checks[name] = {"status": "PASS", "detail": detail}

    def fail(self, name, detail):
        self.checks[name] = {"status": "FAIL", "detail": detail}
        self.errors.append({"check": name, "detail": detail})

    def warn(self, name, detail, limitation=None):
        self.checks[name] = {"status": "WARN", "detail": detail}
        self.warnings.append({"check": name, "detail": detail,
                              "core_limitation": limitation})

    def skip(self, name, detail=""):
        self.checks[name] = {"status": "SKIP", "detail": detail}

    def result(self) -> dict:
        return {"valid": not self.errors, "errors": self.errors,
                "warnings": self.warnings, "checks": self.checks}


# ---------------------------------------------------------------------------
# 个体检查
# ---------------------------------------------------------------------------
def _check_shape(acc: _Acc, c: dict) -> None:
    required = ["identity", "input", "status", "confidence", "evidence", "ood",
                "review", "metrics", "quality_control", "warnings", "provenance"]
    missing = [k for k in required if k not in c]
    if missing:
        acc.fail("canonical_shape", f"canonical 缺少必需段：{missing}")
    else:
        acc.ok("canonical_shape", f"schema={c.get('schema')}；必需段齐全")


def _check_ood_split(acc: _Acc, c: dict) -> None:
    ood = c.get("ood") or {}
    md, ed = ood.get("model_distribution"), ood.get("evidence_domain")
    if not isinstance(md, dict) or not isinstance(ed, dict):
        acc.fail("ood_semantics_separated",
                 "canonical.ood 未同时提供 model_distribution 与 evidence_domain"
                 "（两个不同概念必须分离，禁止合并为单一 ood/ood_status）")
        return
    md_out = bool(md.get("is_out_of_distribution"))
    ed_out = bool(ed.get("is_out_of_evidence_domain"))
    detail = (f"model_distribution.status={md.get('status')}（超域={md_out}）；"
              f"evidence_domain.is_out={ed_out}；policy={ed.get('policy')}")
    if md_out and ed_out:
        acc.warn("ood_semantics_separated",
                 detail + " → 两者同时为真：需向用户说明它们分别指『输入特征范围』与"
                          "『历史证据锚点/近邻支撑』，不构成自相矛盾。")
    else:
        acc.ok("ood_semantics_separated", detail)


def _check_holes(acc: _Acc, c: dict) -> None:
    h = (c.get("metrics") or {}).get("holes") or {}
    total, parts = h.get("total"), h.get("sum_of_parts")
    holes_len = h.get("holes_len")
    if total is None or parts is None:
        acc.skip("holes_sum_consistency", "缺少 counts.total / 分项")
        return
    if int(total) != int(parts):
        acc.fail("holes_sum_consistency",
                 f"炮孔总数 {total} != 各类型之和 {parts}"
                 "（cut+relief+aux+peripheral+bottom）")
        return
    if holes_len is not None and int(holes_len) != int(total):
        acc.fail("holes_sum_consistency",
                 f"GEOMETRY_SNAPSHOT.holes 条数 {holes_len} != counts.total {total}")
        return
    acc.ok("holes_sum_consistency", f"total={total} = 分项之和；holes 条数一致")


def _check_gap(acc: _Acc, c: dict) -> None:
    mb = (c.get("evidence") or {}).get("mass_balance") or {}
    if mb.get("gap_agree") is None:
        acc.skip("mass_balance_gap_consistency", "缺少 gap / mass_balance_error")
    elif mb["gap_agree"]:
        acc.ok("mass_balance_gap_consistency",
               f"joint.gap={mb.get('joint_gap')} == mass_balance_error="
               f"{mb.get('mass_balance_error')}")
    else:
        acc.fail("mass_balance_gap_consistency",
                 f"joint.gap={mb.get('joint_gap')} != mass_balance_error="
                 f"{mb.get('mass_balance_error')}")


def _check_final_status(acc: _Acc, c: dict) -> None:
    st = (c.get("status") or {}).get("final")
    rev = c.get("review") or {}
    flags = rev.get("reasons") or []
    ed_reasons = ((c.get("ood") or {}).get("evidence_domain") or {}).get("reasons") or []
    joined = "".join(str(r) for r in ed_reasons)

    if st == "AUTO_RECOMMENDED":
        if flags:
            acc.fail("final_status_vs_flags",
                     f"AUTO_RECOMMENDED 但 review_flags 非空：{flags}")
        else:
            acc.ok("final_status_vs_flags", "AUTO_RECOMMENDED 且无 review_flags")
    elif st == "CANDIDATE_REFERENCE":
        if not ed_reasons:
            acc.fail("final_status_vs_flags",
                     "CANDIDATE_REFERENCE 但 ood.reasons 为空"
                     "（Core 决策树要求 OOD 且无 CBR 支撑）")
        elif "CBR" in joined:
            acc.warn("final_status_vs_flags",
                     f"CANDIDATE_REFERENCE 但 ood.reasons 含 CBR 字样：{ed_reasons}；"
                     "按 Core 决策树此情形应给 RECOMMENDED_WITH_REVIEW，需人工确认")
        elif not rev.get("required"):
            acc.fail("final_status_vs_flags", "CANDIDATE_REFERENCE 但 review.required 非真")
        else:
            acc.ok("final_status_vs_flags",
                   "CANDIDATE_REFERENCE 与『证据域超域 + 无 CBR 支撑 + 需复核』自洽")
    elif st == "RECOMMENDED_WITH_REVIEW":
        if not flags:
            acc.fail("final_status_vs_flags", "RECOMMENDED_WITH_REVIEW 但 review_flags 为空")
        else:
            acc.ok("final_status_vs_flags",
                   f"RECOMMENDED_WITH_REVIEW 且有 {len(flags)} 条复核标记")
    elif st == "BLOCKED_BY_HARD_CONSTRAINT":
        err = (c.get("status") or {}).get("reason")
        inp_err = ((c.get("input") or {}).get("input_errors")) or []
        if err or inp_err:
            acc.ok("final_status_vs_flags", "BLOCKED 且提供原因/输入错误")
        else:
            acc.fail("final_status_vs_flags", "BLOCKED_BY_HARD_CONSTRAINT 但无原因说明")
    else:
        acc.fail("final_status_vs_flags", f"未知或缺失 FINAL_STATUS：{st}")


def _check_review(acc: _Acc, c: dict) -> None:
    rev = c.get("review") or {}
    flags = rev.get("reasons") or []
    need = bool(rev.get("required"))
    final_req_present = (rev.get("final_review") or {}).get("required") is not None
    if need != bool(flags) and not final_req_present:
        acc.fail("review_required_consistency",
                 f"review.required={need} 与 review_flags 数量={len(flags)} 不一致")
        return
    p6 = rev.get("phase6_manual_review") or {}
    trap = (p6.get("required") is True and p6.get("reason_available") is False)
    detail = (f"required={need}；flags={len(flags)}；phase6.required={p6.get('required')}；"
              f"phase6.reason_available={p6.get('reason_available')}")
    if trap:
        acc.warn("review_required_consistency",
                 detail + " → Core 生产路径不写 manual_review_reason"
                          "（reason 不可用 ≠ 无需复核）；canonical 已用 reason_available=false "
                          "与说明显式标注",
                 limitation="PHASE6_MANUAL_REVIEW_REASON_NOT_WRITTEN_IN_PRODUCTION")
    else:
        acc.ok("review_required_consistency", detail)


def _check_confidence(acc: _Acc, c: dict) -> None:
    conf = c.get("confidence") or {}
    if not conf.get("consistent", True):
        acc.fail("confidence_consistency",
                 f"conf.overall={conf.get('overall')} != FINAL_STATUS.detail.confidence="
                 f"{conf.get('core_final_status_confidence')}")
    else:
        acc.ok("confidence_consistency",
               f"overall={conf.get('overall')}；FINAL_STATUS.detail.confidence="
               f"{conf.get('core_final_status_confidence')}")
    if conf.get("core_final_status_confidence") is not None and conf.get("overall") == "LOW":
        acc.warn("confidence_source_semantics",
                 "FINAL_STATUS.detail.confidence 由 Core 在 CANDIDATE_REFERENCE 分支固定写入 "
                 "LOW（非从 Phase6 传递）；权威源为 conf.overall",
                 limitation="FINAL_STATUS_CONFIDENCE_IS_LITERAL_IN_CANDIDATE_BRANCH")


def _check_qc(acc: _Acc, c: dict) -> None:
    qc = ((c.get("quality_control") or {}).get("unified_qc")) or {}
    st = (c.get("status") or {}).get("final")
    if not qc:
        acc.skip("unified_qc_vs_status", "无 ENGINEERING_QC.json")
    else:
        bad = [k for k, v in qc.items() if not str(v).startswith("YES")]
        if bad and st == "AUTO_RECOMMENDED":
            acc.fail("unified_qc_vs_status", f"AUTO_RECOMMENDED 但 QC 未通过项：{bad}")
        elif bad:
            acc.ok("unified_qc_vs_status", f"QC 未通过项 {bad}（状态 {st}，二者不矛盾）")
        else:
            acc.ok("unified_qc_vs_status", "QC 全项 YES")

    jc = ((c.get("quality_control") or {}).get("joint_calibration")) or {}
    if jc.get("severity") == "OOD" and jc.get("gap_band_visible_in_severity") is False:
        acc.warn("joint_severity_semantics",
                 f"severity=OOD（Core 在 OOD 时短路 gap 分级），gap={jc.get('gap')}；"
                 "报告第 6 节只显示 severity=OOD，不反映 gap 落在哪个阈值带",
                 limitation="SEVERITY_OOD_OVERRIDES_GAP_BAND")
    else:
        acc.ok("joint_severity_semantics", f"severity={jc.get('severity')} gap={jc.get('gap')}")


def _check_artifacts(acc: _Acc, arts: list) -> None:
    if not arts:
        acc.skip("artifacts_exist", "无 artifacts")
        return
    missing = [a["name"] for a in arts if not Path(a["path"]).is_file()]
    empty = [a["name"] for a in arts if int(a.get("bytes") or 0) <= 0]
    if missing:
        acc.fail("artifacts_exist", f"以下 artifact 路径不存在：{missing}")
    elif empty:
        acc.fail("artifacts_exist", f"以下 artifact 为空文件：{empty}")
    else:
        acc.ok("artifacts_exist", f"{len(arts)} 个产物均存在且非空")


def _check_charge_method(acc: _Acc, c: dict) -> None:
    qc = ((c.get("quality_control") or {}).get("unified_qc")) or {}
    m = (c.get("metrics") or {}).get("charge") or {}
    if str(qc.get("CHARGE_METHOD_LOGGED")) == "YES" and not m.get("method_used"):
        acc.fail("charge_method_logged",
                 "QC 声明 CHARGE_METHOD_LOGGED=YES 但 metrics.charge.method_used 为空")
    else:
        acc.ok("charge_method_logged",
               f"method_used={m.get('method_used')} fallback={m.get('fallback_triggered')}")


# ---------------------------------------------------------------------------
# 报告 ↔ canonical 一致性（报告由 Core 生成，本检查只读解析）
# ---------------------------------------------------------------------------
_RE_HOLES = re.compile(r"掏槽孔\s*(\d+)\s*\|\s*空孔/卸压孔\s*(\d+)\s*\|\s*辅助孔\s*(\d+)"
                       r"\s*\|\s*周边孔\s*(\d+)\s*\|\s*炮孔总数\s*(\d+)")
_RE_TOTAL_Q = re.compile(r"推荐总装药量 total_charge_kg\s*=\s*([0-9.]+)")
_RE_STATUS = re.compile(r"\*\*最终状态:\s*([A-Z_]+)（")
_RE_CONF = re.compile(r"overall_confidence\s*=\s*([A-Z]+)\s*\|\s*ood_status\s*=\s*([A-Z_]+)")
_RE_P6REVIEW = re.compile(r"Phase6 人工复核:\s*(.+)")
_RE_SEVERITY = re.compile(r"severity\s*=\s*(\S+)\s*\|\s*状态 status\s*=\s*(\S+)")


def _check_report(acc: _Acc, c: dict, report: Path) -> None:
    if not report.is_file():
        acc.skip("report_vs_canonical", f"无报告文件：{report}")
        return
    txt = report.read_text(encoding="utf-8", errors="replace")
    problems, notes = [], []

    m = _RE_HOLES.search(txt)
    if m:
        rep_total = int(m.group(5))
        rep_parts = sum(int(m.group(i)) for i in range(1, 5))
        can_total = ((c.get("metrics") or {}).get("holes") or {}).get("total")
        if rep_parts != rep_total:
            problems.append(f"报告孔数分项和 {rep_parts} != 报告总数 {rep_total}")
        if can_total is not None and rep_total != int(can_total):
            problems.append(f"报告总数 {rep_total} != canonical {can_total}")
        else:
            notes.append(f"holes={rep_total}")
    else:
        notes.append("report holes line not parsed")

    m = _RE_TOTAL_Q.search(txt)
    if m:
        rep_q = float(m.group(1))
        can_q = ((c.get("metrics") or {}).get("charge") or {}).get("total_charge_kg")
        if can_q is None or abs(rep_q - float(can_q)) > 1e-6:
            problems.append(f"报告总装药量 {rep_q} != canonical {can_q}")
        else:
            notes.append(f"total_charge={rep_q}")

    m = _RE_STATUS.search(txt)
    if m:
        if m.group(1) != (c.get("status") or {}).get("final"):
            problems.append(f"报告状态 {m.group(1)} != canonical "
                            f"{(c.get('status') or {}).get('final')}")
        else:
            notes.append(f"status={m.group(1)}")

    m = _RE_CONF.search(txt)
    if m:
        rep_conf, rep_ood = m.group(1), m.group(2)
        can_conf = (c.get("confidence") or {}).get("overall")
        can_md = ((c.get("ood") or {}).get("model_distribution") or {}).get("status")
        if can_conf and rep_conf != can_conf:
            problems.append(f"报告置信度 {rep_conf} != canonical {can_conf}")
        if can_md and rep_ood != can_md:
            problems.append(f"报告 ood_status {rep_ood} != canonical {can_md}")
        notes.append(f"conf={rep_conf}/ood_status={rep_ood}")

    # --- Core 显示层缺陷检测（保留原文，不修改报告）-----------------------
    m = _RE_P6REVIEW.search(txt)
    if m:
        val = m.group(1).strip()
        if val.lower() == "none":
            acc.warn("report_phase6_review_literal_none",
                     "报告第 8 节出现『Phase6 人工复核: None』；Core 生产路径不写 "
                     "manual_review_reason，None 不代表『无需复核』"
                     "（真实结论见 canonical.review.required）",
                     limitation="REPORT_CONTAINS_LITERAL_NONE_IN_MANUAL_REVIEW_LINE")
        else:
            notes.append(f"p6_review={val}")

    m = _RE_SEVERITY.search(txt)
    if m and m.group(1) == "OOD":
        acc.warn("report_severity_ood_unsplit",
                 f"报告第 6 节 severity=OOD（gap 分级被短路）；"
                 f"canonical.quality_control 已给出 gap 与阈值",
                 limitation="SEVERITY_OOD_OVERRIDES_GAP_BAND")

    if ("ood_status" in txt) and ("OUT_OF_DOMAIN" in txt):
        acc.warn("report_two_ood_concepts_unsplit",
                 "报告第 7 节 ood_status 与第 8 节 OUT_OF_DOMAIN 并排出现且未标注语义差异；"
                 "canonical.ood 已将两者拆为 model_distribution / evidence_domain",
                 limitation="TWO_MEANINGS_OF_OOD_SHARE_ONE_WORD")

    if problems:
        acc.fail("report_vs_canonical", "；".join(problems))
    else:
        acc.ok("report_vs_canonical",
               "报告关键字段与 canonical 一致；" + "，".join(notes))


# ---------------------------------------------------------------------------
# 任务台账 / 引用检查（compare-results 与 parent_task_id）
# ---------------------------------------------------------------------------
def _check_task_chain(acc: _Acc, task_id: str | None, taskmeta: dict) -> None:
    if not task_id:
        acc.skip("task_index_chain", "未以 task_id 指定（历史冻结案例无台账）")
        return
    row = None
    for r in taskstore.list_tasks(limit=10 ** 6):
        if r.get("task_id") == task_id:
            row = r
            break
    if row is None:
        acc.fail("task_index_chain", f"index.json 中不存在 task_id={task_id}")
        return
    parent = row.get("parent_task_id")
    if parent:
        par = next((r for r in taskstore.list_tasks(limit=10 ** 6)
                    if r.get("task_id") == parent), None)
        if par is None:
            acc.fail("task_index_chain", f"parent_task_id={parent} 不在台账中")
            return
        if par.get("case_id") != row.get("case_id"):
            acc.warn("task_index_chain",
                     f"parent {parent} 的 case_id={par.get('case_id')} 与子任务 "
                     f"case_id={row.get('case_id')} 不同（改参重跑通常保持同一 case_id，"
                     "请确认是否为有意更名）")
        else:
            acc.ok("task_index_chain", f"parent={parent} 存在且 case_id 一致")
    else:
        acc.ok("task_index_chain", "无 parent（首轮任务）")

    st = taskstore.read_status(task_id) or {}
    pkg = Path(st.get("package_dir") or "")
    if st.get("package_dir") and not pkg.is_dir():
        acc.fail("task_index_chain", f"STATUS.package_dir 不存在：{st.get('package_dir')}")
    elif taskmeta.get("out_dir") and Path(taskmeta["out_dir"]).resolve() != pkg.resolve():
        acc.warn("task_index_chain",
                 f"canonical.identity.out_dir 与 STATUS.package_dir 不一致："
                 f"{taskmeta.get('out_dir')} vs {pkg}")


def _check_compare(acc: _Acc, a_dir: Path, b_dir: Path) -> None:
    """校验 compare 两侧引用的 task/case 与各自产物自洽。"""
    def one(d: Path, label: str):
        inp = artifacts.read_json(d, "INPUT.json") or {}
        fs = artifacts.read_json(d, "FINAL_STATUS.json") or {}
        return inp.get("case_id"), fs.get("case_id"), fs.get("status")

    ca1, ca2, sa = one(a_dir, "A")
    cb1, cb2, sb = one(b_dir, "B")
    if ca1 and ca2 and ca1 != ca2:
        acc.fail("compare_reference", f"A 侧 case_id 不自洽：INPUT={ca1} FINAL_STATUS={ca2}")
    elif cb1 and cb2 and cb1 != cb2:
        acc.fail("compare_reference", f"B 侧 case_id 不自洽：INPUT={cb1} FINAL_STATUS={cb2}")
    else:
        acc.ok("compare_reference",
               f"A={ca1}（{sa}） B={cb1}（{sb}）；两侧输出包与声明的 case 一致")
    if a_dir.resolve() == b_dir.resolve():
        acc.fail("compare_reference", "两侧指向同一个输出目录，比较无意义")


# ---------------------------------------------------------------------------
# 顶层入口
# ---------------------------------------------------------------------------
def run(task_id: str | None = None, case_id: str | None = None,
        out_dir=None, compare: tuple | None = None,
        with_report: bool = True) -> dict:
    """执行全部一致性检查。**只读**，不修改任何文件。"""
    from .services import result_service  # 延迟导入，避免循环依赖

    acc = _Acc()
    meta = {}
    if out_dir is None:
        try:
            out_dir, source, tid = result_service.resolve_out_dir(
                task_id=task_id, case_id=case_id)
        except FileNotFoundError as exc:
            acc.fail("resolve_target", str(exc))
            return acc.result()
        task_id = tid or task_id
    out_dir = Path(out_dir)

    if task_id:
        row = next((r for r in taskstore.list_tasks(limit=10 ** 6)
                    if r.get("task_id") == task_id), None) or {}
        st = taskstore.read_status(task_id) or {}
        meta = {"task_id": task_id, "parent_task_id": row.get("parent_task_id"),
                "source": "task", "out_dir": st.get("package_dir")}
    else:
        meta = {"source": "frozen", "task_id": None, "parent_task_id": None}

    c = canon.build(out_dir, meta)
    arts = artifacts.collect_artifacts(out_dir)
    c["artifacts"] = arts

    _check_shape(acc, c)
    _check_ood_split(acc, c)
    _check_holes(acc, c)
    _check_gap(acc, c)
    _check_final_status(acc, c)
    _check_review(acc, c)
    _check_confidence(acc, c)
    _check_qc(acc, c)
    _check_charge_method(acc, c)
    _check_artifacts(acc, arts)
    if with_report:
        _check_report(acc, c, out_dir / "ONE_CLICK_REPORT.md")
    _check_task_chain(acc, task_id, meta)

    if compare:
        try:
            a_dir, _, _ = result_service.resolve_out_dir(
                task_id=compare[0] or None, case_id=compare[2])
            b_dir, _, _ = result_service.resolve_out_dir(
                task_id=compare[1] or None, case_id=compare[3])
            _check_compare(acc, Path(a_dir), Path(b_dir))
        except Exception as exc:  # noqa: BLE001
            acc.fail("compare_reference", f"无法解析比较对象：{exc}")

    out = acc.result()
    out["target"] = {"task_id": task_id, "case_id": c.get("identity", {}).get("case_id"),
                     "out_dir": str(out_dir.resolve())}
    out["counts"] = {
        "checks": len(out["checks"]),
        "pass": sum(1 for v in out["checks"].values() if v["status"] == "PASS"),
        "warn": sum(1 for v in out["checks"].values() if v["status"] == "WARN"),
        "fail": sum(1 for v in out["checks"].values() if v["status"] == "FAIL"),
        "skip": sum(1 for v in out["checks"].values() if v["status"] == "SKIP"),
    }
    return out




