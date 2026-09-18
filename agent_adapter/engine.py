# -*- coding: utf-8 -*-
"""agent_adapter.engine — 唯一 Core 调用点。

本模块是适配层与既有生产项目之间的**唯一**桥梁：
  - 只 import 51_one_click_end_to_end 的公共入口（OneClickPipeline / run_case）；
  - 不复制、不包装、不修改任何计算逻辑与参数默认值；
  - 校验也复用 Core 的 normalize_input / validate_input（避免出现两套校验口径）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import config


def load_orchestrator():
    """惰性 import Core 编排模块（首次约 1 秒；校验命令因此保持轻量）。"""
    config.ensure_core_paths()
    import one_click_orchestrator as OC  # noqa: E402
    return OC


def normalize_input(raw: dict) -> dict:
    """复用 Core 归一化（含 case_id 自动生成与 _units 标注）。"""
    return load_orchestrator().normalize_input(dict(raw or {}))


def validate_input(inp: dict) -> tuple:
    """复用 Core 硬校验。返回 (ok, errors)。"""
    return load_orchestrator().validate_input(dict(inp or {}))


def run_case(raw_input: dict, out_root, use_ml: bool | None = None,
             use_6e: bool | None = None) -> dict:
    """调用唯一生产流水线。**这是本项目唯一的重计算入口。**

    与 `51_one_click_end_to_end/run_one_click_design.py` 走同一条
    `OneClickPipeline.run()`，因此结果天然一致（GUI 回归测试已验证该等价性）。
    """
    OC = load_orchestrator()
    ml = config.USE_ML if use_ml is None else bool(use_ml)
    six_e = config.USE_6E if use_6e is None else bool(use_6e)
    pipe = OC.OneClickPipeline(use_6e=six_e, use_ml=ml)
    return pipe.run(dict(raw_input or {}), out_root=Path(out_root))


# ---------------------------------------------------------------------------
# 图件重渲染入口（以已落盘快照为输入，不重算任何工程数值）
# ---------------------------------------------------------------------------
def render_plan(snap: dict, base: Path) -> list:
    """平面布孔图 PNG/PDF/SVG（复用 Core 渲染器）。"""
    OC = load_orchestrator()
    return OC.render_plan_2d(snap, Path(base))


def render_plan_dxf(snap: dict, path: Path) -> None:
    """平面布孔 DXF（复用 Core CAD 导出器）。"""
    OC = load_orchestrator()          # 确保 43 等目录已进 sys.path
    import cad_exporter as ce  # noqa: E402
    ce.export_2d(snap, Path(path))


def render_3d_preview(snap: dict, path: Path) -> None:
    """三维炮孔布置预览 PNG（复用 Core CAD 导出器）。"""
    OC = load_orchestrator()
    import cad_exporter as ce  # noqa: E402
    ce.preview_3d(snap, Path(path))


def render_charge_structure(snap: dict, structure: dict, stem: Path) -> None:
    """装药结构剖面图 PNG/PDF/SVG（复用 47 冻结渲染器）。"""
    OC = load_orchestrator()
    import charge_structure_engine as cs_e  # noqa: E402
    cs_e.render_charge_structure(snap, structure, Path(stem))


def render_report(result: dict, out_dir: Path) -> Path:
    """ONE_CLICK_REPORT.md（复用 Core 报告生成器；result 为已落盘的真实结果）。"""
    OC = load_orchestrator()
    import one_click_report as OCR  # noqa: E402
    return OCR.generate(dict(result or {}), Path(out_dir))


def extract_explanation_trace(case_output_dir: Path) -> dict:
    """工程决策解释追溯（复用 52_gui_v1 只读提取层，不触发任何重算）。"""
    config.ensure_core_paths()
    if str(config.CORE52) not in sys.path:
        sys.path.insert(0, str(config.CORE52))
    from explainability import explanation_trace as ET  # noqa: E402
    return ET.extract_explanation_trace(Path(case_output_dir))
