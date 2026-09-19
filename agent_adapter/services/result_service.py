# -*- coding: utf-8 -*-
"""agent_adapter.services.result_service — 只读读取 / 对比 / 会话找回。

包含：
  - summarize(out_dir)      ：输出包 → 摘要（复用 GUI 已验证的只读解析）
  - get_result(...)         ：task_id / case_id → 结构化结果（不重算）
  - compare(...)            ：两个真实结果的字段级差异（纯减法，无新算法）
  - list_recent(...)        ：最近任务
"""
from __future__ import annotations

from pathlib import Path

from .. import artifacts, config, engine, envelope, taskstore

TOOL_GET = "get_project_result"
TOOL_COMPARE = "compare_project_results"
TOOL_LIST = "list_project_tasks"

#: 参与对比的数值指标（全部取自真实结果字段，不做任何推定）
COMPARE_FIELDS = (
    "total_holes", "cut_holes", "aux_holes", "peripheral_holes", "relief_holes",
    "aux_rings", "peripheral_spacing_mm", "q_design_kg_m3",
    "charge_cut_kg", "charge_aux_kg", "charge_peripheral_kg", "total_charge_kg",
    "mass_balance_gap_pct",
)


def _gui_summary(out_dir) -> dict:
    """复用 52_gui_v1 的只读摘要解析（已由 GUI 回归测试覆盖）。"""
    config.ensure_core_paths()
    try:
        import gui_backend_adapter as GBA  # noqa: E402
        return GBA.collect_result_summary(Path(out_dir))
    except Exception as exc:  # noqa: BLE001
        return {"_error": f"{type(exc).__name__}: {exc}"}


def summarize(out_dir) -> dict:
    """输出包 → (results, metrics, warnings, status)。只读、不重算。"""
    d = Path(out_dir)
    summary = _gui_summary(d)
    # 装药方法证据位于 CHARGE_RECOMMENDATION.json 的 _ml 段（与 Core 报告口径一致）
    charge = artifacts.read_json(d, "CHARGE_RECOMMENDATION.json") or {}
    ml = (charge or {}).get("_ml") or {}
    status = summary.get("status")

    metrics = {k: summary.get(k) for k in COMPARE_FIELDS}
    metrics["confidence"] = summary.get("confidence")
    metrics["charge_method_requested"] = ml.get("method_requested")
    metrics["charge_method_used"] = ml.get("method_used")
    metrics["charge_fallback_triggered"] = ml.get("fallback_triggered")

    results = {
        "status": status,
        "status_reason": summary.get("status_reason"),
        "status_review_flags": summary.get("status_review_flags") or [],
        "charge_method": {
            "requested": ml.get("method_requested"),
            "used": ml.get("method_used"),
            "fallback_triggered": ml.get("fallback_triggered"),
            "fallback_reason": ml.get("fallback_reason"),
        },
        "readiness": {
            "reference_intervals": (artifacts.read_json(d, "RECOMMENDATION_RESULT.json") or {}).get("conf"),
            "ood": (artifacts.read_json(d, "JOINT_CALIBRATION.json") or {}).get("ood"),
        },
        "summary": summary,
        "ready_fields": artifacts.ready_fields(d),
        "note": ("所有数值均来自 51_one_click_end_to_end 生产流水线的真实产物文件；"
                 "本适配层未做任何重算、插值或修正。"),
    }
    return results, metrics, list(summary.get("warnings") or []), status


def resolve_out_dir(task_id: str | None = None, case_id: str | None = None,
                    allow_frozen: bool = True) -> tuple:
    """定位输出目录。返回 (out_dir, source, task_id)。

    source: "task"（适配层本次运行）| "frozen"（51/outputs 历史证据库，只读）
    """
    if task_id:
        st = taskstore.read_status(task_id)
        if st is None and not taskstore.task_dir(task_id).is_dir():
            raise FileNotFoundError(f"未找到 task_id={task_id}（无任务目录）")
        return taskstore.package_dir(task_id), "task", task_id
    if case_id:
        row = taskstore.find_task_by_case(case_id, phases=("done",))
        if row:
            return taskstore.package_dir(row["task_id"]), "task", row["task_id"]
        if allow_frozen:
            frozen = taskstore.frozen_case_dir(case_id)
            if frozen:
                return frozen, "frozen", None
        row = taskstore.find_task_by_case(case_id)
        if row:
            return taskstore.package_dir(row["task_id"]), "task", row["task_id"]
    raise FileNotFoundError(
        "无法定位结果：请提供 task_id（本次运行）或 case_id（历史案例，如 P0535）。")



def build_envelope(tool: str, out_dir, task_id: str | None, source: str) -> dict:
    """由输出目录构造标准信封（含真实产物清单 + canonical + render）。"""
    from .. import canonical as canon_builder, render_cues

    results, metrics, warnings, status = summarize(out_dir)
    env = envelope.ok(
        tool,
        task_id=task_id,
        case_id=(results.get("summary") or {}).get("case_id"),
        status=status,
        results=dict(results, source=source, out_dir=str(Path(out_dir).resolve())),
        metrics=metrics,
        warnings=warnings,
    )
    for art in artifacts.collect_artifacts(out_dir):
        env["artifacts"].append(art)

    # ---- Canonical Result Contract（Phase 1.6）：Agent 的唯一标准解释 ----
    meta = {"task_id": task_id, "source": source}
    if task_id:
        row = next((r for r in taskstore.list_tasks(limit=10 ** 6)
                    if r.get("task_id") == task_id), None) or {}
        meta["parent_task_id"] = row.get("parent_task_id")
    c = canon_builder.build(out_dir, meta)
    c["artifacts"] = list(env["artifacts"])
    env["results"]["canonical"] = c
    env["results"]["render"] = render_cues.render(c, env["artifacts"])
    # 状态以 canonical 为准（同一 Core 字段，避免两处口径漂移）
    env["status"] = c.get("status", {}).get("final") or env.get("status")
    return env



def get_result(task_id: str | None = None, case_id: str | None = None,
               section: str = "summary", json_name: str | None = None) -> dict:
    """读取真实结果（默认摘要粒度；不触发任何重算）。

    section:
      - "summary"  : 状态 + 指标 + 警告 + 产物清单（推荐，体积小）
      - "package"  : 输出包全部 JSON 原样返回（体积大，仅在确需明细时使用）
      - "explain"  : 工程决策解释追溯（复用 52_gui_v1 只读提取层）
    json_name: 只读取指定 JSON（如 "CHARGE_STRUCTURE.json"），与 section 二选一。
    """
    try:
        out_dir, source, tid = resolve_out_dir(task_id=task_id, case_id=case_id)
    except FileNotFoundError as exc:
        return envelope.fail(TOOL_GET, "RESULT_NOT_FOUND", str(exc),
                             task_id=task_id, case_id=case_id)

    env = build_envelope(TOOL_GET, out_dir, tid or task_id, source)

    if json_name:
        data = artifacts.read_json(out_dir, json_name)
        if data is None:
            return envelope.fail(TOOL_GET, "JSON_NOT_FOUND",
                                 f"输出包中不存在或无内容：{json_name}",
                                 task_id=task_id, case_id=case_id,
                                 results={"out_dir": str(out_dir)})
        env["results"]["requested_json"] = {"name": json_name, "data": data}
    elif section == "package":
        env["results"]["package"] = artifacts.load_package(out_dir)
    elif section == "canonical":
        env["results"]["canonical"] = ((env.get("results") or {}).get("canonical")
                                       or {})
    elif section == "explain":
        try:
            env["results"]["explanation_trace"] = engine.extract_explanation_trace(out_dir)
        except Exception as exc:  # noqa: BLE001
            env["warnings"].append(f"解释追溯提取失败（不影响结果本身）：{type(exc).__name__}: {exc}")
    elif section == "render":
        # 只返回确定性展示块（最小的第一屏数据）
        env["results"] = {
            "render": (env.get("results") or {}).get("render"),
            "out_dir": str(out_dir),
        }
    elif section != "summary":
        return envelope.fail(TOOL_GET, "BAD_SECTION",
                             f"未知 section={section}；"
                             "可用：summary | package | canonical | render | explain",
                             task_id=task_id, case_id=case_id)


    if env.get("status") == "BLOCKED_BY_HARD_CONSTRAINT":
        env["next_actions"] = ["修正输入参数后重新 run_project_analysis"]
    else:
        env["next_actions"] = [
            "generate_project_figures（需要重新出图时）",
            "generate_project_report（输出中文报告）",
            "compare_project_results（与另一方案对比）",
        ]
    return env


def compare(task_a: str, task_b: str, case_a: str | None = None,
            case_b: str | None = None) -> dict:
    """两个真实方案的字段级对比（纯减法；绝不重新计算任何工程量）。"""
    try:
        dir_a, src_a, tid_a = resolve_out_dir(task_id=task_a or None, case_id=case_a)
        dir_b, src_b, tid_b = resolve_out_dir(task_id=task_b or None, case_id=case_b)
    except FileNotFoundError as exc:
        return envelope.fail(TOOL_COMPARE, "RESULT_NOT_FOUND", str(exc),
                             warnings=[f"task_a={task_a} case_a={case_a}",
                                       f"task_b={task_b} case_b={case_b}"])

    res_a, met_a, warn_a, st_a = summarize(dir_a)
    res_b, met_b, warn_b, st_b = summarize(dir_b)
    in_a = artifacts.read_json(dir_a, "INPUT.json") or {}
    in_b = artifacts.read_json(dir_b, "INPUT.json") or {}

    input_diff, metric_diff = {}, {}
    for k in ("shaft_depth_m", "shaft_diameter_m", "protodyakonov_f",
              "planned_advance_mm", "borehole_diameter_mm", "borehole_depth_mm"):
        if in_a.get(k) != in_b.get(k):
            input_diff[k] = {"a": in_a.get(k), "b": in_b.get(k)}
    for k in COMPARE_FIELDS:
        va, vb = met_a.get(k), met_b.get(k)
        if va is None and vb is None:
            continue
        entry = {"a": va, "b": vb}
        try:
            entry["delta"] = round(float(vb) - float(va), 6)
        except (TypeError, ValueError):
            entry["delta"] = None
        metric_diff[k] = entry

    env = envelope.ok(
        TOOL_COMPARE,
        task_id=tid_b or task_b,
        case_id=(res_b.get("summary") or {}).get("case_id"),
        status=st_b,
        results={
            "a": {"task_id": tid_a or task_a, "source": src_a,
                  "case_id": (res_a.get("summary") or {}).get("case_id"),
                  "status": st_a, "out_dir": str(Path(dir_a).resolve())},
            "b": {"task_id": tid_b or task_b, "source": src_b,
                  "case_id": (res_b.get("summary") or {}).get("case_id"),
                  "status": st_b, "out_dir": str(Path(dir_b).resolve())},
            "input_diff": input_diff,
            "metric_diff": metric_diff,
            "status_change": {"a": st_a, "b": st_b},
            "canonical_diff": _canonical_diff(dir_a, dir_b),
            "note": ("delta = b - a，直接来自两侧真实结果字段；"
                     "本工具不做任何工程推断或优劣判定。"),
        },
        metrics={"changed_input_fields": len(input_diff),
                 "changed_metric_fields": len(metric_diff)},
        warnings=list(dict.fromkeys(warn_a + warn_b)),
    )
    return env


#: canonical 层参与对比的定性/关键字段（全部来自 Core，按路径取值）
_CANON_COMPARE_PATHS = [
    ("status.final", "方案状态"),
    ("confidence.overall", "置信度"),
    ("review.required", "需要人工复核"),
    ("ood.model_distribution.status", "模型输入分布"),
    ("ood.evidence_domain.is_out_of_evidence_domain", "证据域超域"),
    ("ood.evidence_domain.policy", "证据域策略"),
    ("quality_control.joint_calibration.severity", "联合校准严重度"),
    ("quality_control.joint_calibration.gap", "质量平衡偏差"),
    ("metrics.holes.total", "炮孔总数"),
    ("metrics.charge.total_charge_kg", "总装药量(kg)"),
    ("metrics.charge.method_used", "装药方法"),
]


def _dig(d, dotted):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _canonical_diff(dir_a: Path, dir_b: Path) -> dict:
    """canonical 层的定性对比（两个不同概念按各自语义分别比较，不做优劣判定）。"""
    from .. import canonical as canon_builder

    ca = canon_builder.build(dir_a, {"source": "compare_a", "task_id": None})
    cb = canon_builder.build(dir_b, {"source": "compare_b", "task_id": None})
    rows, changed = [], 0
    for path, label in _CANON_COMPARE_PATHS:
        va, vb = _dig(ca, path), _dig(cb, path)
        same = va == vb
        if not same:
            changed += 1
        rows.append({"path": path, "label_cn": label, "a": va, "b": vb, "same": same})
    only_a = sorted(set((ca.get("review") or {}).get("reasons") or [])
                    - set((cb.get("review") or {}).get("reasons") or []))
    only_b = sorted(set((cb.get("review") or {}).get("reasons") or [])
                    - set((ca.get("review") or {}).get("reasons") or []))
    return {
        "fields": rows,
        "changed_count": changed,
        "review_flags_only_in_a": only_a,
        "review_flags_only_in_b": only_b,
        "note": ("ood 按两个概念分别比较（model_distribution = 输入特征范围；"
                 "evidence_domain = 历史证据锚点/近邻支撑）；本对比不做优劣判定。"),
    }



def list_recent(limit: int | None = None) -> dict:
    rows = taskstore.list_tasks(limit=limit)
    env = envelope.ok(
        TOOL_LIST,
        results={
            "tasks": rows,
            "workspace": str(config.WORKSPACE_DIR),
            "running": [r["task_id"] for r in rows if r.get("phase") in ("queued", "running")],
            "note": "phase 已按磁盘 STATUS.json 校正；out_dir 为真实输出包目录。",
        },
        metrics={"count": len(rows)},
    )
    if rows:
        env["next_actions"] = [
            f"get_project_result --task-id {rows[0]['task_id']}",
            f"compare_project_results --task-a {rows[0]['task_id']} --task-b <另一个task_id>",
        ]
    return env

