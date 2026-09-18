# -*- coding: utf-8 -*-
"""agent_adapter.services.figure_service — generate_project_figures。

以**已落盘的真实快照**为输入，调用 Core 的冻结渲染器重新出图：
    GEOMETRY_SNAPSHOT.json  →  FINAL_PLAN.{png,pdf,svg} / FINAL_PLAN.dxf / FINAL_3D_PREVIEW.png
    CHARGE_STRUCTURE.json   →  CHARGE_STRUCTURE.{png,pdf,svg}

纪律：
  - 不重新执行任何工程计算（不跑 Phase6 / 几何 / 装药 / 校准）；
  - 绝不生成"示意图代替真实图"，也绝不由 LLM 画图；
  - 输出一律写到 workspace 下的新目录，**不覆盖**既有输出包（含 51/outputs 冻结证据）。
"""
from __future__ import annotations

import datetime
from pathlib import Path

from .. import artifacts, config, engine, envelope, taskstore
from . import result_service

TOOL = "generate_project_figures"

#: target → 该目标会产出的文件后缀（用于结果汇报）
TARGET_FILES = {
    "plan": ("FINAL_PLAN", ("png", "pdf", "svg", "dxf")),
    "3d": ("FINAL_3D_PREVIEW", ("png",)),
    "charge": ("CHARGE_STRUCTURE", ("png", "pdf", "svg")),
}


def _out_dir(case_id: str) -> Path:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    d = config.WORKSPACE_DIR / "figures" / f"{case_id}_{stamp}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def generate(task_id: str | None = None, case_id: str | None = None,
             targets=("plan", "3d", "charge")) -> dict:
    try:
        src_dir, source, tid = result_service.resolve_out_dir(task_id=task_id,
                                                             case_id=case_id)
    except FileNotFoundError as exc:
        return envelope.fail(TOOL, "RESULT_NOT_FOUND", str(exc),
                             task_id=task_id, case_id=case_id)

    snap = artifacts.snapshot(src_dir)
    if not snap:
        return envelope.fail(
            TOOL, "SNAPSHOT_MISSING",
            f"输出包中缺少 GEOMETRY_SNAPSHOT.json，无法重渲染真实图件：{src_dir}",
            task_id=task_id, case_id=case_id,
            results={"source_dir": str(src_dir),
                     "ready_fields": artifacts.ready_fields(src_dir)})

    cid = str(snap.get("case_id") or case_id or tid or "CASE")
    out = _out_dir(cid)
    warnings, produced, failed_targets = [], [], []
    targets = tuple(targets) or ("plan", "3d", "charge")

    for target in targets:
        try:
            if target == "plan":
                for f in engine.render_plan(snap, out / "FINAL_PLAN"):
                    produced.append(f)
                engine.render_plan_dxf(snap, out / "FINAL_PLAN.dxf")
                produced.append(str(out / "FINAL_PLAN.dxf"))
            elif target == "3d":
                engine.render_3d_preview(snap, out / "FINAL_3D_PREVIEW.png")
                produced.append(str(out / "FINAL_3D_PREVIEW.png"))
            elif target == "charge":
                structure = artifacts.charge_structure(src_dir)
                if not structure:
                    failed_targets.append(target)
                    warnings.append("CHARGE_STRUCTURE.json 不存在，跳过装药结构图（不伪造）。")
                    continue
                engine.render_charge_structure(snap, structure, out / "CHARGE_STRUCTURE")
                produced.extend(str(out / f"CHARGE_STRUCTURE.{e}")
                                for e in ("png", "pdf", "svg"))
            else:
                failed_targets.append(target)
                warnings.append(f"未知 target={target}；可用：plan | 3d | charge")
        except Exception as exc:  # noqa: BLE001
            failed_targets.append(target)
            warnings.append(f"{target} 渲染失败：{type(exc).__name__}: {exc}")

    env = envelope.ok(
        TOOL,
        task_id=tid or task_id,
        case_id=cid,
        status="FIGURES_RENDERED" if produced else "FIGURES_FAILED",
        results={
            "source_dir": str(Path(src_dir).resolve()),
            "source": source,
            "out_dir": str(out.resolve()),
            "targets": list(targets),
            "failed_targets": failed_targets,
            "inputs_used": ["GEOMETRY_SNAPSHOT.json", "CHARGE_STRUCTURE.json"],
            "note": ("图件由 Core 冻结渲染器基于真实快照重新生成；"
                     "未重新执行任何工程计算，也未由模型绘制或修改任何数值。"),
        },
        metrics={"produced_count": len(produced), "failed_count": len(failed_targets)},
        warnings=warnings,
    )
    for f in produced:
        envelope.add_artifact(env, f, artifacts.KIND_BY_SUFFIX.get(Path(f).suffix.lower(),
                                                                  "other"))
    env["next_actions"] = [
        "把 artifacts[].path 直接作为图片/图纸路径展示给用户",
        "generate_project_report（需要中文报告时）",
    ]
    return env
