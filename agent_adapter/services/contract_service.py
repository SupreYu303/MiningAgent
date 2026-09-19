# -*- coding: utf-8 -*-
"""agent_adapter.services.contract_service — Canonical 契约与一致性校验工具。

两个工具（**只读，不修改任何结果**）：
  - `get_canonical_result`  —— 输出 canonical result + 确定性展示块
  - `validate_result_consistency` —— Result Consistency Validator
"""
from __future__ import annotations

from pathlib import Path

from .. import (artifacts, canonical as canon_builder, consistency, envelope,
                render_cues, taskstore)
from . import result_service

TOOL_CANON = "get_canonical_result"
TOOL_VALIDATE = "validate_result_consistency"


def canonical_result(task_id: str | None = None, case_id: str | None = None,
                     with_render: bool = True, with_raw: bool = False) -> dict:
    """返回 canonical result（唯一标准解释）。with_raw=True 时附带原始 JSON 包。"""
    try:
        out_dir, source, tid = result_service.resolve_out_dir(task_id=task_id,
                                                             case_id=case_id)
    except FileNotFoundError as exc:
        return envelope.fail(TOOL_CANON, "RESULT_NOT_FOUND", str(exc),
                             task_id=task_id, case_id=case_id)

    meta = {"task_id": tid or task_id, "source": source}
    if tid:
        row = next((r for r in taskstore.list_tasks(limit=10 ** 6)
                    if r.get("task_id") == tid), None) or {}
        meta["parent_task_id"] = row.get("parent_task_id")

    c = canon_builder.build(out_dir, meta)
    c["artifacts"] = artifacts.collect_artifacts(out_dir)
    env = envelope.ok(
        TOOL_CANON,
        task_id=tid or task_id,
        case_id=c.get("identity", {}).get("case_id"),
        status=c.get("status", {}).get("final"),
        input={"normalized": (c.get("input") or {}).get("normalized")},
        results={"canonical": c, "source": source,
                 "out_dir": str(Path(out_dir).resolve())},
        metrics=(c.get("metrics") or {}),
        warnings=[w.get("text") for w in (c.get("warnings") or [])],
    )
    if with_render:
        env["results"]["render"] = render_cues.render(c, c["artifacts"])
    if with_raw:
        env["results"]["raw_package"] = artifacts.load_package(out_dir)
    env["artifacts"] = c["artifacts"]
    env["next_actions"] = [
        "按 results.render.must_state / core_metrics / engineering_notices 汇报",
        "必要时 validate-result-consistency 自检",
    ]
    return env


def validate(task_id: str | None = None, case_id: str | None = None,
             compare: tuple | None = None) -> dict:
    """Result Consistency Validator：只校验、不修改。

    compare: (task_a, task_b, case_a, case_b) 可选，用于校验对比引用。
    """
    rep = consistency.run(task_id=task_id, case_id=case_id, compare=compare)
    if rep.get("errors") and any(e["check"] == "resolve_target" for e in rep["errors"]):
        return envelope.fail(TOOL_VALIDATE, "RESULT_NOT_FOUND",
                             rep["errors"][0]["detail"],
                             task_id=task_id, case_id=case_id)
    ok = bool(rep.get("valid"))
    env = envelope.ok(
        TOOL_VALIDATE,
        task_id=rep.get("target", {}).get("task_id") or task_id,
        case_id=rep.get("target", {}).get("case_id") or case_id,
        status="CONSISTENT" if ok else "INCONSISTENT",
        results={
            "valid": ok,
            "errors": rep.get("errors") or [],
            "checks": rep.get("checks") or {},
            "counts": rep.get("counts") or {},
            "target": rep.get("target") or {},
            "note": ("本工具只读校验，不修改任何 Core 产物；"
                     "warnings 中的 core_limitation 为 Core 的真实限制（不做隐藏）。"),
        },
        metrics={"checks": (rep.get("counts") or {}).get("checks", 0),
                 "pass": (rep.get("counts") or {}).get("pass", 0),
                 "warn": (rep.get("counts") or {}).get("warn", 0),
                 "fail": (rep.get("counts") or {}).get("fail", 0),
                 "skip": (rep.get("counts") or {}).get("skip", 0)},
        warnings=[f"{w['check']}: {w['detail']}" for w in (rep.get("warnings") or [])],
    )
    if not ok:
        env["success"] = True          # 校验本身执行成功；不一致性由 results.valid 表达
        env["next_actions"] = [
            "按 results.errors 定位问题来源（多数情况下为 Core 真实限制，已在 warnings 标注）",
            "不要修改 Core 产物；如需澄清语义，请更新 canonical/展示层口径",
        ]
    else:
        env["next_actions"] = ["结果自洽，可继续汇报或执行下一步工具"]
    return env
