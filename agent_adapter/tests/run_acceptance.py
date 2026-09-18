# -*- coding: utf-8 -*-
"""agent_adapter/tests/run_acceptance.py — 适配层验收脚本（可重复运行）。

用法：
    python agent_adapter/tests/run_acceptance.py             # 快速验收（不跑重算）
    python agent_adapter/tests/run_acceptance.py --full       # 含一次完整方案计算

纪律：本脚本只调用 CLI（与 Agent 走完全相同的入口），不 import 任何工程算法。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TMP = REPO / ".agent_tmp"
PY = sys.executable

RESULTS = []


def cli(*args) -> dict:
    cmd = [PY, "-m", "agent_adapter.cli", *args]
    proc = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    text = (proc.stdout or "").strip()
    env = None
    try:
        env = json.loads(text)
    except Exception:  # noqa: BLE001
        # 兜底：截取第一个 '{' 到最后一个 '}' 之间的内容
        try:
            env = json.loads(text[text.index("{"): text.rindex("}") + 1])
        except Exception:  # noqa: BLE001
            env = None
    if env is None:
        env = {"success": False,
               "error": {"message": (text[-400:] + (proc.stderr or "")[-400:])}}
    env["_exit"] = proc.returncode
    return env



def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""),
          flush=True)


def write_req(name: str, data: dict) -> Path:
    TMP.mkdir(parents=True, exist_ok=True)
    p = TMP / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


GOOD = {
    "case_id": "ACCEPT_DEMO",
    "shaft_depth_m": 500, "shaft_diameter_m": 6.0, "protodyakonov_f": 8,
    "planned_advance_mm": 3500, "borehole_diameter_mm": 55, "borehole_depth_mm": 4000,
}
BAD = {"shaft_depth_m": 500, "shaft_diameter_m": 6.0, "protodyakonov_f": 0,
       "planned_advance_mm": 5000, "borehole_diameter_mm": 55, "borehole_depth_mm": 4000}


def fast_phase() -> None:
    env = cli("doctor")
    c = (env.get("results") or {}).get("checks") or {}
    core_ok = all(c.get(k) for k in ("core51_present", "numpy", "matplotlib",
                                     "ezdxf", "workspace_writable", "validate_smoke"))
    check("doctor 环境自检（core+deps+smoke）", env.get("success") and core_ok,
          f"checks={sum(1 for v in c.values() if v)}/{len(c)}")
    check("doctor 识别项目 Skill 文件", c.get("skill_present") is True)

    good = write_req("accept_good.json", GOOD)
    env = cli("validate-input", "--input-file", str(good))
    r = env.get("results") or {}
    check("validate-input 合法输入 → valid=true",
          env.get("success") and r.get("valid") is True
          and env.get("status") == "INPUT_VALIDATION_PASS",
          f"case_id={env.get('case_id')} elapsed={env.get('elapsed_s')}s")

    bad = write_req("accept_bad.json", BAD)
    env = cli("validate-input", "--input-file", str(bad))
    r = env.get("results") or {}
    check("validate-input 非法输入 → 硬约束阻止 + Core 原生错误",
          r.get("valid") is False and bool(r.get("errors"))
          and env.get("status") == "BLOCKED_BY_HARD_CONSTRAINT",
          f"errors={r.get('errors')}")

    env = cli("get-result", "--case-id", "P0535")
    r = env.get("results") or {}
    m = env.get("metrics") or {}
    check("get-result 历史冻结案例（只读）",
          env.get("success") and r.get("source") == "frozen"
          and (m.get("total_holes") or 0) > 0 and len(env.get("artifacts") or []) > 10,
          f"status={env.get('status')} total_holes={m.get('total_holes')} "
          f"artifacts={len(env.get('artifacts') or [])}")

    env = cli("compare-results", "--case-a", "P0535", "--case-b", "P0753")
    r = env.get("results") or {}
    check("compare-results 两真实方案字段级 diff",
          env.get("success") and bool(r.get("metric_diff")) and bool(r.get("input_diff")),
          f"changed_metrics={len(r.get('metric_diff') or {})}")

    env = cli("generate-figures", "--case-id", "P0535", "--targets", "plan")
    arts = env.get("artifacts") or []
    check("generate-figures 基于快照重渲染（历史案例，不覆盖原包）",
          env.get("success") and any(a["name"] == "FINAL_PLAN.png" for a in arts),
          f"produced={[a['name'] for a in arts]}")

    env = cli("generate-report", "--case-id", "P0535")
    check("generate-report 对历史案例拒绝重算（并给出既有报告）",
          env.get("success") is False
          and (env.get("results") or {}).get("existing_report") is not None,
          f"code={(env.get('error') or {}).get('code')}")

    env = cli("list-tasks")
    check("list-tasks 任务台账可读", env.get("success") is True,
          f"count={(env.get('metrics') or {}).get('count')}")


def _poll(tid: str, timeout_s: int = 600):
    t0 = time.time()
    phase = None
    while time.time() - t0 < timeout_s:
        st = cli("task-status", "--task-id", tid)
        phase = (st.get("results") or {}).get("phase")
        print(f"      · 轮询 phase={phase} "
              f"elapsed={(st.get('metrics') or {}).get('elapsed_s')}s", flush=True)
        if phase in ("done", "failed"):
            return phase
        time.sleep(10)
    return phase


def full_phase() -> None:
    good = write_req("accept_full.json", dict(GOOD, case_id="ACCEPT_FULL"))
    env = cli("run-analysis", "--input-file", str(good))
    tid = env.get("task_id")
    check("run-analysis 后台启动，秒级返回 task_id",
          env.get("success") and bool(tid)
          and (env.get("results") or {}).get("mode") == "background",
          f"task_id={tid} elapsed={env.get('elapsed_s')}s")
    if not tid:
        return
    FULL_TASK_IDS["a"] = tid

    phase = _poll(tid)
    check("task-status 轮询至结束", phase == "done", f"phase={phase}")

    env = cli("get-result", "--task-id", tid)
    m = env.get("metrics") or {}
    check("get-result 真实指标与产物",
          env.get("success") and (m.get("total_holes") or 0) > 0
          and len(env.get("artifacts") or []) >= 20,
          f"status={env.get('status')} total_holes={m.get('total_holes')} "
          f"total_charge_kg={m.get('total_charge_kg')} "
          f"artifacts={len(env.get('artifacts') or [])}")

    env = cli("generate-figures", "--task-id", tid, "--targets", "plan,3d,charge")
    names = [a["name"] for a in (env.get("artifacts") or [])]
    check("generate-figures 三目标全部产出",
          env.get("success") and "FINAL_PLAN.png" in names
          and "FINAL_3D_PREVIEW.png" in names and "CHARGE_STRUCTURE.png" in names,
          f"names={names}")

    env = cli("generate-report", "--task-id", tid)
    rp = (env.get("results") or {}).get("report_path")
    check("generate-report 生成中文报告",
          env.get("success") and bool(rp) and Path(rp).is_file()
          and Path(rp).stat().st_size > 500,
          f"report={rp}")

    good2 = write_req("accept_full2.json",
                      dict(GOOD, case_id="ACCEPT_FULL2", shaft_diameter_m=5.0))
    env = cli("run-analysis", "--input-file", str(good2), "--parent-task-id", tid)
    tid2 = env.get("task_id")
    check("run-analysis 改参重跑（记录 parent_task_id）",
          env.get("success") and bool(tid2), f"task_id={tid2}")
    if not tid2:
        return
    FULL_TASK_IDS["b"] = tid2
    _poll(tid2)
    env = cli("compare-results", "--task-a", tid, "--task-b", tid2)
    r = env.get("results") or {}
    check("compare-results 两任务对比（改直径后差异可见）",
          env.get("success")
          and (r.get("metric_diff") or {}).get("total_holes") is not None,
          f"diameter={(r.get('input_diff') or {}).get('shaft_diameter_m')} "
          f"total_holes={(r.get('metric_diff') or {}).get('total_holes')}")


FULL_TASK_IDS: dict = {}


def _full_task_ids():
    return (FULL_TASK_IDS.get("a"), FULL_TASK_IDS.get("b"))


def _contract_phase(tid_a: str, tid_b: str) -> None:
    """Phase 1.6 验收：canonical 契约 + 一致性校验（两项任务各一次 + 对比）。"""
    env = cli("canonical-result", "--task-id", tid_b)
    r = env.get("results") or {}
    c = r.get("canonical") or {}
    rn = r.get("render") or {}
    ood = c.get("ood") or {}
    rev = c.get("review") or {}
    check("canonical-result 能完整表示结果（含 ood/review/metrics/artifacts）",
          env.get("success") and c.get("schema") == "canonical_result.v1"
          and all(k in c for k in ("identity", "input", "status", "confidence",
                                   "evidence", "ood", "review", "metrics",
                                   "quality_control", "warnings", "artifacts",
                                   "provenance", "limitations"))
          and len(c.get("artifacts") or []) >= 20,
          f"schema={c.get('schema')} artifacts={len(c.get('artifacts') or [])}")

    md = ood.get("model_distribution") or {}
    ed = ood.get("evidence_domain") or {}
    check("OOD 两个概念已分离且均有语义说明（不再语义矛盾）",
          isinstance(md, dict) and isinstance(ed, dict)
          and md.get("status") == "IN_DISTRIBUTION"
          and ed.get("is_out_of_evidence_domain") is True
          and bool(md.get("semantics")) and bool(ed.get("semantics"))
          and "与历史记录是否存在无关" in md.get("semantics", ""),
          f"model_distribution={md.get('status')} evidence_domain_out="
          f"{ed.get('is_out_of_evidence_domain')} policy={ed.get('policy')} "
          f"no_hist={(ed.get('checks') or {}).get('no_historical_record')} "
          f"knn_ood={(ed.get('checks') or {}).get('knn_density_ood')}")

    p6 = rev.get("phase6_manual_review") or {}
    check("review 状态不再矛盾（required 明确 + None 不被当作无需复核）",
          rev.get("required") is True and p6.get("required") is True
          and p6.get("reason_available") is False
          and bool(p6.get("reason_unavailable_explanation"))
          and p6.get("cause_flags"),
          f"required={rev.get('required')} p6.required={p6.get('required')} "
          f"p6.reason_available={p6.get('reason_available')} "
          f"causes={p6.get('cause_flags')}")

    check("展示层确定性口径（CANDIDATE_REFERENCE 不得表达为已批准）",
          rn.get("can_be_called_approved") is False
          and "未获系统正式批准" in (rn.get("approval_state_cn") or "")
          and "系统已正式批准" in (rn.get("prohibited_claims_cn") or [])
          and len(rn.get("core_metrics") or []) <= 8
          and len(rn.get("must_state") or []) >= 5,
          f"approved={rn.get('can_be_called_approved')} "
          f"metrics={len(rn.get('core_metrics') or [])} "
          f"must_state={len(rn.get('must_state') or [])}")

    ca = cli("validate-result-consistency", "--task-id", tid_a)
    cb = cli("validate-result-consistency", "--task-id", tid_b)
    for label, env in (("A", ca), ("B", cb)):
        rr = env.get("results") or {}
        check(f"validate-result-consistency PASS（{label}）",
              env.get("success") and rr.get("valid") is True
              and (rr.get("counts") or {}).get("fail") == 0,
              f"checks={(rr.get('counts') or {}).get('checks')} "
              f"pass={(rr.get('counts') or {}).get('pass')} "
              f"warn={(rr.get('counts') or {}).get('warn')} "
              f"fail={(rr.get('counts') or {}).get('fail')}")

    check("Validator 未产生 error（仅对 Core 真实限制出 warning）",
          not ((ca.get("results") or {}).get("errors") or []),
          f"errors={(ca.get('results') or {}).get('errors')}")
    warning_texts = " ".join(ca.get("warnings") or [])
    check("Core 真实限制被显式登记而非隐藏",
          ("manual_review_reason" in warning_texts) and ("None" in warning_texts),
          "warnings 含 manual_review_reason / 报告 None 的显式标注")

    cc = cli("validate-result-consistency", "--task-id", tid_b,
             "--compare-a", tid_a, "--compare-b", tid_b)
    rcc = cc.get("results") or {}
    check("compare 引用校验通过（引用正确 task）",
          cc.get("success") and rcc.get("valid") is True
          and (rcc.get("checks") or {}).get("compare_reference", {}).get("status") == "PASS",
          f"compare_reference="
          f"{(rcc.get('checks') or {}).get('compare_reference', {}).get('detail')}")

    cmp_env = cli("compare-results", "--task-a", tid_a, "--task-b", tid_b)
    cd = ((cmp_env.get("results") or {}).get("canonical_diff")) or {}
    check("compare-results 提供 canonical 层对比",
          cmp_env.get("success") and bool(cd.get("fields"))
          and (cd.get("changed_count") or 0) > 0,
          f"changed={cd.get('changed_count')} fields={len(cd.get('fields') or [])}")

    # Core 结果回归基线（与 Phase 1 记录一致 → 证明未改变生产结果）
    get_env = cli("get-result", "--task-id", tid_a)
    m = ((get_env.get("results") or {}).get("canonical") or {}).get("metrics") or {}
    check("既有生产 Core 结果未发生变化（回归基线）",
          (m.get("holes") or {}).get("total") == 64
          and abs(float((m.get("charge") or {}).get("total_charge_kg") or 0) - 156.184) < 1e-6,
          f"total_holes={(m.get('holes') or {}).get('total')} "
          f"total_charge={(m.get('charge') or {}).get('total_charge_kg')}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="包含完整方案计算（约 2~4 分钟）")
    args = ap.parse_args()

    print("=== AGENT ADAPTER ACCEPTANCE ===", flush=True)
    print(f"repo={REPO}", flush=True)
    fast_phase()
    if args.full:
        print("\n--- 完整流水线阶段 ---", flush=True)
        full_phase()
        print("\n--- Phase 1.6 契约阶段 ---", flush=True)
        tid_a, tid_b = _full_task_ids()
        if tid_a and tid_b:
            _contract_phase(tid_a, tid_b)
        else:
            check("Phase 1.6 契约阶段", False, "未取得 A/B task_id")

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nADAPTER_ACCEPTANCE = "
          f"{'PASS' if passed == total else 'FAIL'} ({passed}/{total})")
    return 0 if passed == total else 1



    print("=== AGENT ADAPTER ACCEPTANCE ===", flush=True)
    print(f"repo={REPO}", flush=True)
    fast_phase()
    if args.full:
        print("\n--- 完整流水线阶段 ---", flush=True)
        full_phase()

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\nADAPTER_ACCEPTANCE = "
          f"{'PASS' if passed == total else 'FAIL'} ({passed}/{total})")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())


