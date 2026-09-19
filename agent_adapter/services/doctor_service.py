# -*- coding: utf-8 -*-
"""agent_adapter.services.doctor_service — 环境自检（只读，不跑流水线）。

用于在会话开始时快速确认"能不能算"，避免 Agent 在环境不满足时反复试错。
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

from .. import config, envelope

TOOL = "doctor"

#: 自检用的最小可用样例（仅为环境连通性测试，不写入任何生产目录）
SAMPLE_INPUT = {
    "case_id": "DOCTOR_SMOKE",
    "shaft_depth_m": 500.0,
    "shaft_diameter_m": 6.0,
    "protodyakonov_f": 8.0,
    "planned_advance_mm": 3500.0,
    "borehole_diameter_mm": 55.0,
    "borehole_depth_mm": 4000.0,
}


def _has(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except Exception:  # noqa: BLE001
        return False


def run(with_validate_smoke: bool = True) -> dict:
    cfg = config.describe()
    checks = {}

    checks["core51_present"] = cfg["core51_exists"] and cfg["core51_entry_exists"]
    checks["python_ge_310"] = sys.version_info >= (3, 10)
    checks["numpy"] = _has("numpy")
    checks["matplotlib"] = _has("matplotlib")
    checks["ezdxf"] = _has("ezdxf")
    checks["torch_optional"] = _has("torch")
    checks["skill_present"] = (config.REPO_ROOT / ".dsh" / "skills" /
                               "shaft-blast-design" / "SKILL.md").is_file()

    writable = True
    try:
        config.ensure_dirs()
        probe = config.WORKSPACE_DIR / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except Exception:  # noqa: BLE001
        writable = False
    checks["workspace_writable"] = writable

    smoke = None
    if with_validate_smoke and checks["core51_present"]:
        try:
            config.ensure_core_paths()
            from . import input_service
            env = input_service.validate(SAMPLE_INPUT)
            smoke = {
                "valid": (env.get("results") or {}).get("valid"),
                "errors": (env.get("results") or {}).get("errors"),
                "elapsed_s": env.get("elapsed_s"),
            }
            checks["validate_smoke"] = bool((env.get("results") or {}).get("valid"))
        except Exception as exc:  # noqa: BLE001
            smoke = {"error": f"{type(exc).__name__}: {exc}"}
            checks["validate_smoke"] = False

    warnings = []
    if not checks["core51_present"]:
        warnings.append("未找到 51_one_click_end_to_end 生产入口 —— 本机无法执行真实计算。")
    if not checks["workspace_writable"]:
        warnings.append("适配层 workspace 不可写 —— 请检查权限或设置 BLAST_AGENT_WORKSPACE。")
    if not checks.get("torch_optional"):
        warnings.append("可选依赖 torch 未安装（仅影响装药 ML 混合路径，失败会自动降级 STATISTICAL_CBR）。")
    if smoke and smoke.get("error"):
        warnings.append("校验冒烟测试异常：" + smoke["error"])

    env = envelope.ok(
        TOOL,
        results={
            "checks": checks,
            "environment": cfg,
            "validate_smoke": smoke,
            "next_actions_hint": ("若 checks 全部为真，可直接按 SKILL.md 的流程调用 "
                                  "validate_project_input → run_project_analysis。"),
        },
        metrics={"passed": sum(1 for v in checks.values() if v),
                 "total": len(checks)},
        warnings=warnings,
    )
    env["next_actions"] = ["validate_project_input（提交真实参数前先校验）"] if not warnings else []
    return env
