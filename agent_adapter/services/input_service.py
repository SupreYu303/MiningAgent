# -*- coding: utf-8 -*-
"""agent_adapter.services.input_service — validate_project_input。

职责：
  - 判断必填/可选参数是否齐全（存在性预检，纯字段级，不含工程算法）；
  - 调用 Core 的 `normalize_input` / `validate_input` 得到**权威**硬校验结论；
  - 输出结构化缺失清单与单位提示，供 Agent 追问用户。

绝不重算任何工程量；不发模型、不起 pipeline（秒级返回）。
"""
from __future__ import annotations

from .. import config, engine, envelope

TOOL = "validate_project_input"

#: 人类可读的字段说明（显示层，不含工程规则；规则一律来自 Core）
FIELD_DOC = {
    "case_id": ("案例编号", "", "可省略；省略时系统自动生成 CASE_YYYYMMDD_HHMMSS。"
                                "以 P 开头的编号会命中历史证据池（如 P0535）。"),
    "shaft_depth_m": ("井筒深度", "m", "工程井筒设计深度。"),
    "shaft_diameter_m": ("井筒设计直径", "m", "圆形立井爆破设计井筒直径。"),
    "protodyakonov_f": ("岩石坚固性系数 f", "", "Protodyakonov 普氏系数。"),
    "planned_advance_mm": ("计划循环进尺", "mm", "本循环期望进尺，必须 ≤ 炮孔深度。"),
    "borehole_diameter_mm": ("炮孔直径", "mm", "钻孔直径。"),
    "borehole_depth_mm": ("炮孔深度", "mm", "本循环炮孔设计深度。"),
}


def field_contract() -> dict:
    """从 Core 读取参数契约（唯一真源，不在此处硬编码规则）。"""
    OC = engine.load_orchestrator()
    required = list(getattr(OC, "REQUIRED_USER_INPUT", []))
    optional = list(getattr(OC, "OPTIONAL_OVERRIDE", []))
    positive = list(getattr(OC, "POSITIVE_FIELDS", []))
    return {
        "required": [f for f in required],
        "positive_fields": positive,
        "optional_override": optional,
        "units": {"shaft_depth_m": "m", "shaft_diameter_m": "m",
                  "planned_advance_mm": "mm", "borehole_diameter_mm": "mm",
                  "borehole_depth_mm": "mm"},
        "documented": {
            f: {"label_cn": FIELD_DOC[f][0], "unit": FIELD_DOC[f][1], "note": FIELD_DOC[f][2]}
            for f in FIELD_DOC
        },
    }


def _presence_check(raw: dict) -> dict:
    """存在性/类型预检（显示层辅助；权威判定仍由 Core validate_input 给出）。"""
    contract = field_contract()
    numeric = [f for f in contract["required"] if f != "case_id"]
    missing, non_numeric, present = [], [], []
    for f in numeric:
        v = raw.get(f)
        if v is None or (isinstance(v, str) and not v.strip()):
            missing.append(f)
            continue
        try:
            float(v)
            present.append(f)
        except (TypeError, ValueError):
            non_numeric.append({"field": f, "value": v})
    return {
        "missing_required": missing,
        "non_numeric": non_numeric,
        "present_numeric": present,
        "case_id_provided": bool(raw.get("case_id")),
        "optional_given": sorted(k for k in contract["optional_override"]
                                if raw.get(k) not in (None, "")),
    }


def validate(raw: dict | None) -> dict:
    raw = dict(raw or {})
    config.ensure_core_paths()

    # 复用 GUI 的数值归一化工具（与 CLI argparse type=float 语义一致）
    try:
        import gui_backend_adapter as GBA  # noqa: E402  （52_gui_v1）
        raw_coerced = GBA.normalize_numeric_inputs(raw)
    except Exception:  # noqa: BLE001
        raw_coerced = raw

    norm = engine.normalize_input(raw_coerced)
    ok, errors = engine.validate_input(norm)
    pre = _presence_check(raw_coerced)
    contract = field_contract()

    warnings = []
    if pre["non_numeric"]:
        warnings.append("以下字段不是数值，Core 会拒绝：" +
                        ", ".join(f"{d['field']}={d['value']!r}" for d in pre["non_numeric"]))
    if not ok and not pre["missing_required"] and not pre["non_numeric"]:
        warnings.append("参数齐全但违反 Core 硬约束，请按 errors 修正后重跑。")

    docs = contract["documented"]
    next_actions = []
    if ok:
        next_actions.append("run_project_analysis（可直接进入完整方案计算）")
    else:
        for f in pre["missing_required"]:
            next_actions.append(f"向用户索取 {f}（{docs[f]['label_cn']}，单位 {docs[f]['unit'] or '—'}）")
        if pre["non_numeric"] or not pre["missing_required"]:
            next_actions.append("按 errors 修正参数后重新 validate_project_input")

    return envelope.ok(
        TOOL,
        case_id=norm.get("case_id"),
        status=("INPUT_VALIDATION_PASS" if ok else "BLOCKED_BY_HARD_CONSTRAINT"),
        input={"raw": raw, "normalized": norm},
        results={
            "valid": ok,
            "errors": errors,
            "missing_required": pre["missing_required"],
            "non_numeric": pre["non_numeric"],
            "optional_given": pre["optional_given"],
            "contract": contract,
            "note": ("valid=true 仅代表通过 Core 硬校验；工程结论（置信度/是否需复核）"
                     "由 run_project_analysis 产出。"),
        },
        metrics={"required_count": len([f for f in contract['required'] if f != 'case_id']),
                 "provided_count": len(pre["present_numeric"]),
                 "error_count": len(errors)},
        warnings=warnings,
        next_actions=next_actions,
    )
