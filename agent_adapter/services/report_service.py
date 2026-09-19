# -*- coding: utf-8 -*-
"""agent_adapter.services.report_service — generate_project_report。

复用 Core 的 `one_click_report.generate(result, out_dir)`（10 章节中文报告）。

关键纪律：
  - 报告内容 100% 由 Core 从**真实 result** 生成；适配层不改一个数字、不加一句结论；
  - 需要完整 result（AGENT_RESULT.json）。命中历史冻结案例（51/outputs）时**不重算**，
    直接告知既有 ONE_CLICK_REPORT.md 的位置，让 Agent 原样展示；
  - 落盘位置：任务型结果就地更新；历史型写入 workspace/reports/ 新目录，绝不改动冻结证据。
"""
from __future__ import annotations

import datetime
from pathlib import Path

from .. import artifacts, config, engine, envelope, taskstore
from . import result_service

TOOL = "generate_project_report"


def _report_dir(case_id: str) -> Path:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    d = config.WORKSPACE_DIR / "reports" / f"{case_id}_{stamp}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def generate(task_id: str | None = None, case_id: str | None = None) -> dict:
    try:
        src_dir, source, tid = result_service.resolve_out_dir(task_id=task_id,
                                                             case_id=case_id)
    except FileNotFoundError as exc:
        return envelope.fail(TOOL, "RESULT_NOT_FOUND", str(exc),
                             task_id=task_id, case_id=case_id)

    result = taskstore.read_result(tid) if tid else None
    if not result:
        existing = artifacts.report_path(src_dir)
        return envelope.fail(
            TOOL, "RESULT_PAYLOAD_MISSING",
            ("未找到本次任务保存的完整 result（AGENT_RESULT.json），"
             "因此无法在不重算的前提下重新生成报告。"
             + ("该结果已自带官方报告文件，请直接展示。" if existing.exists() else "")),
            task_id=tid or task_id, case_id=case_id,
            results={
                "source_dir": str(Path(src_dir).resolve()),
                "source": source,
                "existing_report": str(existing.resolve()) if existing.exists() else None,
                "hint": ("历史冻结案例（51/outputs/*）只读，不会重算；"
                         "如确有需要，请对同一参数执行 run_project_analysis 得到可解释的重算结果。"),
            },
            next_actions=(["把 existing_report 路径直接作为报告交付给用户"]
                          if existing.exists() else
                          ["先执行 run_project_analysis，再生成报告"]),
        )

    out_dir = src_dir if source == "task" else _report_dir(str(result.get("case_id") or case_id))
    try:
        path = engine.render_report(result, out_dir)
    except Exception as exc:  # noqa: BLE001
        return envelope.fail(TOOL, "REPORT_FAILED", str(exc), exc=exc,
                             task_id=tid or task_id, case_id=case_id,
                             results={"out_dir": str(out_dir)})

    env = envelope.ok(
        TOOL,
        task_id=tid or task_id,
        case_id=result.get("case_id"),
        status="REPORT_GENERATED",
        results={
            "report_path": str(Path(path).resolve()),
            "out_dir": str(Path(out_dir).resolve()),
            "sections": ["USER INPUT", "SYSTEM RECOMMENDATIONS",
                         "ENGINEER-ADJUSTABLE PARAMETERS", "FINAL HOLE LAYOUT SUMMARY",
                         "CHARGE DESIGN SUMMARY", "MASS BALANCE",
                         "CONFIDENCE / EVIDENCE", "WARNINGS", "FINAL STATUS",
                         "GENERATED FILE LIST"],
            "note": "报告内容由 Core 从真实结果生成，适配层与模型均未改写任何数值或结论。",
        },
        metrics={},
    )
    envelope.add_artifact(env, path, "report")
    env["next_actions"] = ["把 report_path 直接交付给用户（可同时展示关键指标表）"]
    return env
