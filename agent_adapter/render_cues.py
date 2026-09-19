# -*- coding: utf-8 -*-
"""agent_adapter.render_cues — 确定性展示层（Phase 1.6 §6/§7）。

作用：把 canonical result 映射成**固定措辞**的用户级展示块，使 Agent 不再"自由发挥"
（既避免把 CANDIDATE_REFERENCE 说成"系统正式批准"，也避免把 Core 的 None 解释成"无需复核"）。

纪律：
  - 本模块**只做措辞映射**，不产生任何新的工程数值；
  - 所有数值一律引用 canonical 中的 Core 原值；
  - `prohibited_claims_cn` 明确列出该状态下**禁止**表达的说法；
  - 若 Core l10n 提供中文映射，状态名以其为准（canonical.status.final_cn）。
"""
from __future__ import annotations

#: 四级 FINAL_STATUS 的确定性展示口径（"已批准"语义只对 AUTO_RECOMMENDED 开放）
STATUS_RENDER = {
    "AUTO_RECOMMENDED": {
        "headline_cn": "自动推荐方案",
        "approval_state_cn": "系统默认方案（已通过全部工程校验，无复核标记）",
        "can_be_called_approved": True,
    },
    "RECOMMENDED_WITH_REVIEW": {
        "headline_cn": "推荐方案 —— 建议工程师复核后采用",
        "approval_state_cn": "尚未获得系统正式批准（存在复核标记，需工程师确认）",
        "can_be_called_approved": False,
    },
    "CANDIDATE_REFERENCE": {
        "headline_cn": "候选参考方案 —— 需工程师调整后采用",
        "approval_state_cn": "未获系统正式批准（仅作候选参考；证据有限，采用前须人工调整确认）",
        "can_be_called_approved": False,
    },
    "BLOCKED_BY_HARD_CONSTRAINT": {
        "headline_cn": "硬约束阻止 —— 未生成方案",
        "approval_state_cn": "未生成任何方案（输入违反硬约束，流水线未执行）",
        "can_be_called_approved": False,
    },
}

_FALLBACK_STATUS = {
    "headline_cn": "状态未知（Core 未给出 FINAL_STATUS）",
    "approval_state_cn": "无法判断是否获批 —— 请检查 FINAL_STATUS.json 是否存在",
    "can_be_called_approved": False,
}

#: 非批准状态下禁止出现的说法（防止被误读为"已正式批准"）
PROHIBITED_WHEN_NOT_APPROVED = [
    "系统已正式批准", "已批准", "可直接采用", "最终批准方案", "已通过验收方案",
]

#: 用户级核心指标（固定顺序、固定 ≤8 项；全部来自 canonical.metrics）
CORE_METRIC_ORDER = [
    ("holes.total", "炮孔总数"),
    ("holes.cut", "掏槽孔数"),
    ("holes.aux", "辅助孔数"),
    ("holes.peripheral", "周边孔数"),
    ("design.peripheral_spacing_mm", "周边孔距（mm）"),
    ("design.q_design_kg_m3", "单位炸药消耗量（kg/m³）"),
    ("charge.total_charge_kg", "推荐总装药量（kg）"),
    ("design.shaft_design_diameter_m", "井筒设计直径（m）"),
]


def _get(d, dotted: str):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _model_distribution_text(md: dict) -> str:
    s = md.get("status")
    if s == "IN_DISTRIBUTION":
        return "模型输入分布：IN_DISTRIBUTION（输入特征落在 Phase 6 训练特征范围内）"
    if s == "EDGE":
        return "模型输入分布：EDGE（输入特征接近 Phase 6 训练特征范围边界）"
    if s == "OUT_OF_DISTRIBUTION":
        return "模型输入分布：OUT_OF_DISTRIBUTION（输入特征超出 Phase 6 训练特征范围 +15%）"
    return f"模型输入分布：{s}"


def _evidence_domain_text(ed: dict, checks: dict) -> str:
    if not ed.get("is_out_of_evidence_domain"):
        return "证据域状态：域内（存在历史真值锚点与近邻支撑）"
    why = []
    if checks.get("no_historical_record"):
        why.append("无同名历史真值记录（NO_HISTORICAL_RECORD）")
    if checks.get("feature_range_violations"):
        why.append(f"存在特征超域项 {len(checks['feature_range_violations'])} 条")
    if checks.get("knn_density_ood"):
        why.append("kNN 密度不足")
    txt = "证据域状态：超域 —— 原因：" + "；".join(why or ["见 reasons"])
    if not checks.get("feature_range_violations") and checks.get("knn_density_ood") is False:
        txt += "（特征范围与近邻密度未发现异常）"
    if ed.get("policy"):
        txt += f"；Core 策略：{ed['policy']}"
    return txt


def _flag_impact(flag: str) -> str:
    if flag.startswith("OUT_OF_DOMAIN"):
        return "影响采用前的人工复核要求（不等于特征超域）"
    if flag.startswith("PHASE6_MANUAL_REVIEW_REQUIRED"):
        return "Phase 6 要求人工复核"
    if flag.startswith("PHASE6_CONFIDENCE_LOW"):
        return "Phase 6 置信度低（证据不足）"
    if flag.startswith("MASS_BALANCE"):
        return "质量平衡偏差超出阈值带，需工程师确认"
    if flag.startswith("CHARGE_ML_FALLBACK"):
        return "装药 ML 路径已降级为统计+CBR，须如实告知用户"
    if flag.startswith("CANONICAL_GEOMETRY"):
        return "井筒几何解析带警告"
    return "见 FINAL_STATUS.json:detail.review_flags"


def render(canonical: dict, artifacts: list | None = None) -> dict:
    """canonical → 确定性展示块。Agent 直接引用，无需自行措辞。"""
    st = canonical.get("status") or {}
    core_status = st.get("final")
    sr = STATUS_RENDER.get(core_status, _FALLBACK_STATUS)
    status_cn = st.get("final_cn") or sr["headline_cn"]
    conf = canonical.get("confidence") or {}
    rev = canonical.get("review") or {}
    ood = canonical.get("ood") or {}
    md = ood.get("model_distribution") or {}
    ed = ood.get("evidence_domain") or {}
    checks = ed.get("checks") or {}
    metrics = canonical.get("metrics") or {}
    p6mr = rev.get("phase6_manual_review") or {}

    must_state = [
        {"key": "status", "label_cn": "方案状态", "value": core_status,
         "text_cn": f"{status_cn}（{core_status}）",
         "note_cn": sr["approval_state_cn"]},
        {"key": "confidence", "label_cn": "置信度", "value": conf.get("overall"),
         "text_cn": f"置信度：{conf.get('overall')}",
         "note_cn": "权威源 RECOMMENDATION_RESULT.json:conf.overall；"
                    "其中 "
                    f"{'、'.join(k for k, v in (conf.get('per_target') or {}).items() if v == 'LOW')}"
                    " 等分项为 LOW" if any(v == "LOW" for v in
                                           (conf.get("per_target") or {}).values())
                    else "权威源 RECOMMENDATION_RESULT.json:conf.overall"},
        {"key": "review_required", "label_cn": "需要人工复核", "value": rev.get("required"),
         "text_cn": "需要人工复核：是" if rev.get("required") else "需要人工复核：否",
         "note_cn": ("；".join(rev.get("required_sources") or []) or None)},
        {"key": "evidence_domain", "label_cn": "证据域状态",
         "value": ed.get("is_out_of_evidence_domain"),
         "text_cn": _evidence_domain_text(ed, checks),
         "note_cn": "来源 JOINT_CALIBRATION.json:ood（工程证据域；与模型输入分布不是同一概念）"},
        {"key": "model_distribution", "label_cn": "模型输入分布", "value": md.get("status"),
         "text_cn": _model_distribution_text(md),
         "note_cn": "来源 RECOMMENDATION_RESULT.json:flat.ood_status（Phase 6 输入特征范围判定）"},
    ]

    core_metrics = []
    for dotted, label in CORE_METRIC_ORDER:
        v = _get(metrics, dotted)
        if v is not None:
            core_metrics.append({"label_cn": label, "value": v, "source": f"metrics.{dotted}"})

    notices = []
    for w in canonical.get("warnings") or []:
        if w.get("kind") == "review_flag":
            notices.append({"text": w.get("text"), "text_cn": w.get("text_cn"),
                            "impact_cn": _flag_impact(w.get("text") or "")})
    qc = ((canonical.get("quality_control") or {}).get("unified_qc") or {})
    qc_fail = [k for k, v in qc.items() if not str(v).startswith("YES")]
    if qc_fail:
        notices.append({"text": "UNIFIED_QC", "text_cn": "统一工程 QC 未全项通过：" + ", ".join(qc_fail),
                        "impact_cn": "见 ENGINEERING_QC.json"})

    charge = metrics.get("charge") or {}
    jc = ((canonical.get("quality_control") or {}).get("joint_calibration") or {})
    detail_layer = {
        "task_id": (canonical.get("identity") or {}).get("task_id"),
        "parent_task_id": (canonical.get("identity") or {}).get("parent_task_id"),
        "case_id": (canonical.get("identity") or {}).get("case_id"),
        "source": (canonical.get("identity") or {}).get("source"),
        "out_dir": (canonical.get("identity") or {}).get("out_dir"),
        "charge_method_requested": charge.get("method_requested"),
        "charge_method_used": charge.get("method_used"),
        "charge_method_per_group": charge.get("method_per_group"),
        "charge_fallback_triggered": charge.get("fallback_triggered"),
        "joint_severity": jc.get("severity"),
        "joint_gap": jc.get("gap"),
        "thresholds": (canonical.get("evidence") or {}).get("thresholds"),
        "input_normalized": (canonical.get("input") or {}).get("normalized"),
        "raw_json_pointers": (canonical.get("provenance") or {}).get("files"),
        "phase6_manual_review_reason_available": p6mr.get("reason_available"),
        "limitations": [l.get("id") for l in (canonical.get("limitations") or [])],
    }

    arts = artifacts if artifacts is not None else (canonical.get("artifacts") or [])
    return {
        "headline_cn": sr["headline_cn"],
        "status_cn": status_cn,
        "approval_state_cn": sr["approval_state_cn"],
        "can_be_called_approved": sr["can_be_called_approved"],
        "prohibited_claims_cn": ([] if sr["can_be_called_approved"]
                                 else list(PROHIBITED_WHEN_NOT_APPROVED)),
        "must_state": must_state,
        "core_metrics": core_metrics,
        "engineering_notices": notices,
        "deliverables": [{"kind": a.get("kind"), "name": a.get("name"),
                          "path": a.get("path"), "bytes": a.get("bytes")} for a in (arts or [])],
        "detail_layer": detail_layer,
        "layout_rule_cn": ("第一屏只放：方案状态 / 置信度 / 需要人工复核 / 证据域状态 / "
                           "模型输入分布 / 核心指标（≤8 项）/ 工程提示 / 交付物；"
                           "Task ID、装药方法、fallback、完整参数与原始 JSON 指针放详细层。"),
        "no_value_change_cn": "本展示块只引用 canonical 中的 Core 原值，未做任何数值加工。",
    }


