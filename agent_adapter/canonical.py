# -*- coding: utf-8 -*-
"""agent_adapter.canonical — Canonical Result Contract（Agent 的唯一标准解释层）。

设计纪律（Phase 1.6）：
  1. **不替代、不改写 Core 原始文件**：本模块只读 51_one_click_end_to_end 的真实产物；
  2. **每个字段都可追溯**：`provenance` 记录「canonical 路径 → Core 文件:JSON 路径」；
  3. **不推断、不补值**：Core 没有的字段一律 `null` + `available: false` + 原因说明；
  4. **语义分离**：把 Core 中同名不同义的字段拆成两个显式概念，而不是删改 Core 字段：
       - `ood.model_distribution`  ← Core `flat.ood_status` / `conf.ood_status`
       - `ood.evidence_domain`     ← Core `JOINT_CALIBRATION.ood`
       - `review.phase6_manual_review` ← Core `flat.manual_review_required`
       - `review.final_review`         ← Core `FINAL_STATUS.detail.review_*`
  5. **不隐藏任何 Core 限制**：发现的真实缺陷写入 `limitations`，供 Validator 转成 warning。

Schema 版本：canonical_result.v1（见 agent_adapter/schemas/canonical_result.schema.json）
"""
from __future__ import annotations

import datetime
from pathlib import Path

from . import artifacts, config, engine

SCHEMA = "canonical_result.v1"

#: canonical 路径 → Core 产物文件（字段级溯源见 build() 内逐项标注）
CORE_FILES = {
    "input": "INPUT.json",
    "phase6": "RECOMMENDATION_RESULT.json",
    "canonical_geometry": "CANONICAL_GEOMETRY.json",
    "design": "CURRENT_DESIGN.json",
    "geometry": "GEOMETRY.json",
    "snapshot": "GEOMETRY_SNAPSHOT.json",
    "charge": "CHARGE_RECOMMENDATION.json",
    "joint": "JOINT_CALIBRATION.json",
    "structure": "CHARGE_STRUCTURE.json",
    "qc": "ENGINEERING_QC.json",
    "final_status": "FINAL_STATUS.json",
    "error": "ERROR_REPORT.json",
}


def _cn(fn, value):
    """调用 Core 的 l10n 显示映射（找不到映射时原样返回）。"""
    try:
        return fn(value) if value is not None else None
    except Exception:  # noqa: BLE001
        return value


def core_status_thresholds() -> dict:
    """读取 Core 的工程阈值常量（不硬编码，避免两套数值）。"""
    try:
        return dict(getattr(engine.load_orchestrator(), "THRESHOLDS", {}) or {})
    except Exception:  # noqa: BLE001
        return {}


def build(out_dir, task_meta: dict | None = None) -> dict:
    """由真实输出包构造 canonical result（纯只读）。"""
    d = Path(out_dir)
    task_meta = dict(task_meta or {})
    pkg = artifacts.load_package(d)
    fs = pkg.get("final_status") or {}
    detail = fs.get("detail") or {}
    flat = (pkg.get("recommendation") or {}).get("flat") or {}
    conf = (pkg.get("recommendation") or {}).get("conf") or {}
    crd = pkg.get("current_design") or {}
    snap = pkg.get("geometry_snapshot") or {}
    geom = pkg.get("geometry") or {}
    joint = pkg.get("joint_calibration") or {}
    ood = joint.get("ood") or {}
    kNN = ((ood.get("details") or {}).get("kNN") or {})
    structure = pkg.get("charge_structure") or {}
    charge = pkg.get("charge_recommendation") or {}
    qc = pkg.get("engineering_qc") or {}
    inp = pkg.get("input") or {}
    counts = snap.get("counts") or {}
    mb = joint.get("mass_balance") or {}
    ml = (charge or {}).get("_ml") or {}

    config.ensure_core_paths()
    try:
        engine.load_orchestrator()   # 顺带把 43/23/49/50 等 Core 目录加入 sys.path
        import l10n  # Core 显示层（43_cad_v1_solid_face_circular/l10n.py）
    except Exception:  # noqa: BLE001
        class _L10n:
            """Core l10n 不可用时的降级：所有映射返回原值（绝不编造中文）。"""
            @staticmethod
            def status_cn(v):
                return v

            @staticmethod
            def reason_cn(v):
                return v

            @staticmethod
            def flag_cn(v):
                return v

            @staticmethod
            def field_cn(v):
                return v
        l10n = _L10n()


    # ---- identity ---------------------------------------------------------
    identity = {
        "schema": SCHEMA,
        "case_id": fs.get("case_id") or (pkg.get("input") or {}).get("case_id"),
        "task_id": task_meta.get("task_id"),
        "parent_task_id": task_meta.get("parent_task_id"),
        "source": task_meta.get("source", "task"),
        "out_dir": str(d.resolve()),
        "built_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "core_files_present": artifacts.ready_fields(d),
    }

    # ---- input ------------------------------------------------------------
    input_block = {
        "normalized": inp,
        "units": inp.get("_units") or {},
        "provenance": {"normalized": "INPUT.json"},
    }

    # ---- status（Core 四级，权威）------------------------------------------
    status_block = {
        "final": fs.get("status"),
        "final_cn": _cn(l10n.status_cn, fs.get("status")),
        "level": detail.get("level"),
        "reason": detail.get("reason"),
        "reason_cn": _cn(l10n.reason_cn, detail.get("reason")),
        "engineer_adjustable": detail.get("engineer_adjustable"),
        "provenance": {"final": "FINAL_STATUS.json:status",
                       "reason": "FINAL_STATUS.json:detail.reason"},
    }

    # ---- confidence（以 conf.overall 为权威源）------------------------------
    fs_conf = detail.get("confidence")
    _conf_overall = conf.get("overall") or flat.get("overall_confidence")
    confidence_block = {
        "overall": _conf_overall,
        "per_target": conf.get("per_target") or {},
        "per_target_cn_keys": {k: _cn(l10n.field_cn, k) for k in (conf.get("per_target") or {})},
        "core_final_status_confidence": fs_conf,
        "consistent": (fs_conf is None or fs_conf == _conf_overall),
        "provenance": {
            "overall": "RECOMMENDATION_RESULT.json:conf.overall",
            "per_target": "RECOMMENDATION_RESULT.json:conf.per_target",
            "core_final_status_confidence":
                "FINAL_STATUS.json:detail.confidence（Core 仅在 CANDIDATE_REFERENCE 分支写入，"
                "且为固定字面量 LOW；权威源为 conf.overall）",
        },
    }

    # ---- review：显式区分 Phase6 侧与最终侧（Phase 1.6 §3 核心）-------------
    flags = list(detail.get("review_flags") or [])
    p6_required = flat.get("manual_review_required")
    p6_reason = flat.get("manual_review_reason")          # 生产路径（use_6e=False）Core 不写此字段
    p6_reason_available = "manual_review_reason" in flat
    p6_cause_flags = [f for f in flags if str(f).startswith("PHASE6_")]
    final_required = detail.get("review_required")
    review_required = bool(final_required) if final_required is not None else bool(flags)
    review_block = {
        "required": review_required,
        "required_sources": [
            s for s in (
                ("FINAL_STATUS.json:detail.review_required" if final_required is not None else None),
                ("FINAL_STATUS.json:detail.review_flags（非空即需复核）" if flags else None),
                ("RECOMMENDATION_RESULT.json:flat.manual_review_required" if p6_required is not None else None),
            ) if s
        ],
        "reasons": flags,
        "reasons_cn": [_cn(l10n.flag_cn, f) for f in flags],
        "final_review": {
            "required": final_required,
            "required_effective": bool(final_required) if final_required is not None else bool(flags),
            "flags": flags,
            "flags_cn": [_cn(l10n.flag_cn, f) for f in flags],
            "semantics": "FINAL_STATUS.detail.review_required 仅在 CANDIDATE_REFERENCE 分支由 Core 写入；"
                         "其他分支该键不存在，此时以 review_flags 非空作为『需要复核』的判据"
                         "（等价于 Core 四级决策树：无 flag → AUTO_RECOMMENDED）。",
            "provenance": "FINAL_STATUS.json:detail.review_required / :detail.review_flags",
        },
        "phase6_manual_review": {
            "required": p6_required,
            "reason": p6_reason,
            "reason_available": p6_reason_available,
            "cause_flags": p6_cause_flags,
            "cause_flags_cn": [_cn(l10n.flag_cn, f) for f in p6_cause_flags],
            "semantics": "Phase 6 侧的『是否需要人工复核』标志；生产路径为 "
                         "conf.overall=='LOW' or 存在 R002* 规则调整。",
            "reason_unavailable_explanation": (
                None if p6_reason_available else
                "Core 只在 Model6E 分支（use_6e=True）写 flat.manual_review_reason；"
                "生产路径 use_6e=False 不写该键，因此 reason 不可用（不是『无需复核』）。"
                "ONE_CLICK_REPORT.md 模板会把它渲染成字面量 None，属 Core 显示层缺陷，"
                "已在 limitations 中登记，本轮不修改 Core。"),
            "provenance": "RECOMMENDATION_RESULT.json:flat.manual_review_required"
                          "（+ Model6E 分支才有的 flat.manual_review_reason）",
        },
    }

    # ---- evidence ---------------------------------------------------------
    evidence_block = {
        "cbr_neighbors": [
            {"case_id": flat.get(f"top{i}_case_id"), "similarity": flat.get(f"top{i}_similarity")}
            for i in (1, 2, 3) if flat.get(f"top{i}_case_id")
        ],
        "rule_warning_count": flat.get("rule_warning_count"),
        "rule_warning_summary": flat.get("rule_warning_summary"),
        "mass_balance": {
            "q_group_kg": mb.get("group_based_total_charge"),
            "q_volume_kg": mb.get("volume_based_total_charge"),
            "mass_balance_error": mb.get("mass_balance_error"),
            "joint_gap": joint.get("gap"),
            "gap_agree": (mb.get("mass_balance_error") is None or joint.get("gap") is None
                          or abs(float(mb["mass_balance_error"]) - float(joint["gap"])) < 1e-9),
        },
        "thresholds": core_status_thresholds(),
        "provenance": {
            "cbr_neighbors": "RECOMMENDATION_RESULT.json:flat.top1..3_case_id/similarity",
            "mass_balance": "JOINT_CALIBRATION.json:mass_balance / :gap",
            "thresholds": "51_one_click_end_to_end/one_click_orchestrator.py:THRESHOLDS",
        },
    }

    # ---- ood：两个**不同概念**显式分离（Phase 1.6 §2 核心）-------------------
    md_is_out = str(flat.get("ood_status") or "").upper() == "OUT_OF_DISTRIBUTION"
    md_edge = str(flat.get("ood_status") or "").upper() == "EDGE"
    ed_reasons = list(ood.get("reasons") or [])
    ed_feature_out = [r for r in ed_reasons if "outside [" in r]
    ed_no_record = [r for r in ed_reasons if r.startswith("NO_HISTORICAL_RECORD")]
    ed_knn = [r for r in ed_reasons if "kNN density" in r]
    ood_block = {
        "model_distribution": {
            "status": flat.get("ood_status"),
            "is_out_of_distribution": md_is_out,
            "is_edge": md_edge,
            "semantics": "Phase 6 模型输入分布判定：各输入特征是否落在 case_base.csv 训练范围"
                         "（±5% 记 EDGE，±15% 记 OUT_OF_DISTRIBUTION）。与历史记录是否存在无关。",
            "provenance": "RECOMMENDATION_RESULT.json:flat.ood_status（Core 亦写入 conf.ood_status）",
        },
        "evidence_domain": {
            "is_out_of_evidence_domain": bool(ood.get("is_ood")),
            "reasons": ed_reasons,
            "checks": {
                "no_historical_record": bool((ood.get("details") or {}).get("no_historical_record"))
                                          or bool(ed_no_record),
                "feature_range_violations": ed_feature_out,
                "knn_density_ood": kNN.get("density_ood"),
                "knn_detail": kNN,
            },
            "policy": joint.get("ood_policy"),
            "semantics": "工程证据域判定（Phase 7D ood_policy.detect_ood）："
                         "(0) 是否有同名历史真值记录　(1) 特征是否超出质量门控训练域 P1/P99±15%　"
                         "(2) kNN 密度是否不足。三者任一成立 → is_ood=true。",
            "provenance": "JOINT_CALIBRATION.json:ood / :ood_policy",
        },
        "reconciliation": {
            "both_true": bool(md_is_out) and bool(ood.get("is_ood")),
            "explanation": (
                "二者可以同时为真且互不矛盾：model_distribution 描述『输入特征是否在训练特征范围内』，"
                "evidence_domain 描述『是否存在可验证的历史真值锚点/近邻支撑』。"
                "本案例的常见形态是：特征在域内（IN_DISTRIBUTION）但案例无同名历史记录"
                "（NO_HISTORICAL_RECORD → is_ood=true）。"),
        },
        "provenance_note": "Core 中这两个概念分别叫 flat.ood_status 与 JOINT_CALIBRATION.ood.is_ood；"
                           "canonical 层不重命名 Core 字段，只显式区分引用。",
    }

    # ---- metrics（决策级数值，全部取自 Core）--------------------------------
    groups = (structure or {}).get("hole_groups") or {}
    per_hole = {}
    for g, meta in ({"CUT": "CUT", "AUX": "AUXILIARY", "PERIPHERAL": "PERIPHERAL"}).items():
        ph = ((groups.get(meta) or {}).get("per_hole") or {})
        cm = ph.get("charge_mass_kg") or {}
        per_hole[g] = cm.get("value")
    sum_parts = [counts.get(k) for k in ("cut", "relief", "aux", "peripheral", "bottom")]
    metrics_block = {
        "design": {
            "shaft_design_diameter_m": geom.get("design_diameter_m"),
            "cut_type": crd.get("cut_type_detail") or geom.get("cut_type"),
            "cut_type_method": crd.get("cut_type_method"),
            "borehole_diameter_mm": geom.get("borehole_diameter_mm"),
            "borehole_depth_m": geom.get("borehole_depth_m"),
            "peripheral_spacing_mm": geom.get("peripheral_spacing_mm"),
            "q_design_kg_m3": crd.get("q_design"),
            "explosive_type": crd.get("explosive_type"),
        },
        "holes": {
            "cut": counts.get("cut"), "relief": counts.get("relief"),
            "aux": counts.get("aux"), "peripheral": counts.get("peripheral"),
            "bottom": counts.get("bottom", 0), "total": counts.get("total"),
            "sum_of_parts": (None if any(v is None for v in sum_parts)
                             else int(sum(sum_parts))),
            "holes_len": len(snap.get("holes") or []),
            "aux_rings": ((snap.get("annular_aux") or {}).get("N_aux_ring")),
        },
        "charge": {
            "per_hole_kg": per_hole,
            "total_charge_kg": (structure or {}).get("total_charge_kg"),
            "method_per_group": charge.get("method_summary"),
            "method_used": ml.get("method_used"),
            "method_requested": ml.get("method_requested"),
            "fallback_triggered": ml.get("fallback_triggered"),
            "engineering_constraints_passed": charge.get("engineering_constraints_passed"),
        },
        "provenance": {
            "design": "GEOMETRY.json / CURRENT_DESIGN.json",
            "holes": "GEOMETRY_SNAPSHOT.json:counts / :holes",
            "charge": "CHARGE_STRUCTURE.json:hole_groups,total_charge_kg / "
                      "CHARGE_RECOMMENDATION.json:_ml",
        },
    }

    # ---- quality_control --------------------------------------------------
    qc_block = {
        "unified_qc": qc,
        "all_yes": all(str(v).startswith("YES") for v in qc.values()) if qc else None,
        "joint_calibration": {
            "status": joint.get("status"),
            "severity": joint.get("severity"),
            "gap": joint.get("gap"),
            "status_note": joint.get("status_note"),
            "severity_semantics": (
                "调用 mass_balance_diagnostics.classify_severity(gap, thresholds, ood)："
                "**OOD 时直接返回 'OOD' 并短路 gap 分级**，因此 severity=='OOD' 并不表示"
                "质量平衡不一致，也不反映 gap 落在哪个阈值带；gap 与阈值见 evidence.thresholds。"),
            "gap_band_visible_in_severity": joint.get("severity") != "OOD",
            "provenance": "JOINT_CALIBRATION.json:status / :severity / :gap",
        },
    }

    # ---- warnings（仅 Core 原文，不增删）-----------------------------------
    warnings = []
    for f in flags:
        warnings.append({"kind": "review_flag", "text": f, "text_cn": _cn(l10n.flag_cn, f)})
    for w in (pkg.get("canonical_geometry") or {}).get("warnings") or []:
        warnings.append({"kind": "geometry_warning", "text": w, "text_cn": w})
    if joint.get("status_note"):
        warnings.append({"kind": "joint_status_note", "text": joint["status_note"],
                         "text_cn": joint["status_note"]})
    if pkg.get("error"):
        warnings.append({"kind": "failure", "text": str(pkg["error"]),
                         "text_cn": str(pkg["error"])})

    # ---- limitations（Core 真实限制；供 Validator 转 warning，不隐藏）-------
    limitations = [
        {"id": "PHASE6_MANUAL_REVIEW_REASON_NOT_WRITTEN_IN_PRODUCTION",
         "where": "17_phase6_core_pipeline/recommend_single_case.py:151（仅 Model6E 分支）",
         "effect": "生产路径（use_6e=False）flat 中无 manual_review_reason；"
                   "one_click_report.py 模板渲染为字面量 None，易被误读为『无需复核』。",
         "adapter_handling": "canonical.review.phase6_manual_review.reason_available=false + 显式说明；"
                             "Validator 出 warning。"},
        {"id": "FINAL_STATUS_CONFIDENCE_IS_LITERAL_IN_CANDIDATE_BRANCH",
         "where": "51_one_click_end_to_end/one_click_status.py:91",
         "effect": "detail.confidence 固定写 'LOW'（并非从 Phase6 传递）；"
                   "RECOMMENDED_WITH_REVIEW/BLOCKED 分支不写 confidence/review_required。",
         "adapter_handling": "canonical 以 conf.overall 为权威源并标注两者来源。"},
        {"id": "SEVERITY_OOD_OVERRIDES_GAP_BAND",
         "where": "50_geometry_charge_joint_calibration/mass_balance_diagnostics.py:47",
         "effect": "severity=='OOD' 时 gap 分级被短路；报告第 6 节只显示『severity = OOD』。",
         "adapter_handling": "canonical.quality_control.joint_calibration 显式给出 gap 与阈值，"
                             "并说明 severity 不反映 gap 带。"},
        {"id": "TWO_MEANINGS_OF_OOD_SHARE_ONE_WORD",
         "where": "17_phase6_core_pipeline/core/confidence_engine.py:33 vs "
                  "50_geometry_charge_joint_calibration/ood_policy.py:44",
         "effect": "报告第 7 节 ood_status=IN_DISTRIBUTION 与第 8 节 OUT_OF_DOMAIN 并排出现，"
                   "读者易误判为自相矛盾。",
         "adapter_handling": "canonical.ood 拆为 model_distribution / evidence_domain；"
                             "与 52_gui_v1/explainability/OOD_STATUS_SEMANTICS_AUDIT.md 结论一致，"
                             "本轮不修改 Core。"},
        {"id": "REPORT_CONTAINS_LITERAL_NONE_IN_MANUAL_REVIEW_LINE",
         "where": "51_one_click_end_to_end/one_click_report.py（第 8 节）",
         "effect": "ONE_CLICK_REPORT.md 出现『Phase6 人工复核: None』。",
         "adapter_handling": "Validator 检测并出 warning；Agent 回答以 canonical 为准，禁止照抄 None。"},
    ]

    return {
        "schema": SCHEMA,
        "identity": identity,
        "input": input_block,
        "status": status_block,
        "confidence": confidence_block,
        "evidence": evidence_block,
        "ood": ood_block,
        "review": review_block,
        "metrics": metrics_block,
        "quality_control": qc_block,
        "warnings": warnings,
        "artifacts": [],           # 由调用方（envelope）填充
        "limitations": limitations,
        "provenance": {
            "note": "canonical 路径 → Core 产物文件；所有值均为 Core 原值，未做任何加工。",
            "files": CORE_FILES,
            "derived_only": ["ood.reconciliation.explanation", "review.*.semantics",
                             "quality_control.joint_calibration.severity_semantics",
                             "limitations[*]"],
        },
    }

