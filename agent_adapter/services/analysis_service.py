# -*- coding: utf-8 -*-
"""agent_adapter.services.analysis_service — run_project_analysis。

**这是整个智能体唯一的重计算入口。**

调用链：
    agent_adapter.services.analysis_service.run()
      → agent_adapter.engine.run_case()
        → 51_one_click_end_to_end.one_click_orchestrator.OneClickPipeline.run()
          → Phase6 → CanonicalGeometry → LayoutEngine → Charge7C → JointCalib7D
            → ChargeStructure → CAD v1.3 / True3D → Status/QC → Report

运行模式：
  - background=True（默认推荐）：立刻返回 task_id，分离子进程继续计算；
    用 `task-status` 轮询。规避工具 60s 超时（实测单次约 60s+）。
  - foreground=True：阻塞至完成（供后台 worker 与调试使用）。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from .. import config, engine, envelope, taskstore
from .. import artifacts
from . import result_service

TOOL = "run_project_analysis"
TOOL_STATUS = "task_status"


# ---------------------------------------------------------------------------
# 公共辅助
# ---------------------------------------------------------------------------
def _precheck(norm: dict) -> tuple:
    """进入重算前的 Core 硬校验（避免约 1 分钟白跑）。"""
    return engine.validate_input(norm)


def _fill_envelope(env: dict, task_id: str, out_dir: Path, normalized: dict,
                   result: dict | None, elapsed_s: float) -> dict:
    """把真实产物补进信封（只读解析，不重算）。"""
    pkg = Path(out_dir)
    if pkg.is_dir() and any(pkg.iterdir()):
        built = result_service.build_envelope(TOOL, pkg, task_id, "task")
        env["status"] = built.get("status") or env.get("status")
        env["case_id"] = built.get("case_id") or env.get("case_id")
        env["results"].update(built.get("results") or {})
        env["metrics"].update({k: v for k, v in (built.get("metrics") or {}).items()
                               if v is not None})
        env["warnings"] = list(built.get("warnings") or [])
        env["artifacts"] = built.get("artifacts") or []
    env["input"] = {"normalized": normalized}
    if result is not None:
        env["results"]["stages"] = result.get("stages")
        env["results"]["failure"] = result.get("failure")
        env["results"]["input_errors"] = result.get("input_errors")
    env["elapsed_s"] = elapsed_s
    env["results"]["out_dir"] = str(pkg.resolve())
    return env


def _next_actions(env: dict, task_id: str) -> list:
    if env.get("status") == "BLOCKED_BY_HARD_CONSTRAINT":
        return ["按 results.input_errors 修正输入后重新 validate_project_input",
                "再执行 run_project_analysis"]
    return [
        f"get_project_result --task-id {task_id}",
        f"generate_project_report --task-id {task_id}",
        f"generate_project_figures --task-id {task_id}",
    ]


# ---------------------------------------------------------------------------
# 前台执行（worker 与调试入口）
# ---------------------------------------------------------------------------
def run_foreground(raw: dict, task_id: str | None = None, use_ml: bool | None = None,
                   parent_task_id: str | None = None) -> dict:
    raw = dict(raw or {})
    norm = engine.normalize_input(raw)
    tid = taskstore.create_task(raw, norm, task_id=task_id,
                               parent_task_id=parent_task_id)
    # ---- runtime provenance：本进程自己看到的运行条件（Agent Runtime 是否真的传到了）----
    prov = config.log_provenance_line(tid)
    taskstore.write_json(tid, "RUNTIME_PROVENANCE.json", prov)
    ok, errors = _precheck(norm)
    taskstore.set_status(tid, "running", extra={"case_id": norm.get("case_id"),
                                                "runtime_provenance": prov})

    if not ok:
        # 与 Core 相同语义：不启动重算，直接给出硬约束结论
        taskstore.set_status(tid, "failed", extra={
            "stage": "INPUT_VALIDATION", "reason": "; ".join(errors)})
        taskstore.touch_index(tid, norm.get("case_id"), "failed")
        env = envelope.fail(
            TOOL, "BLOCKED_BY_HARD_CONSTRAINT",
            "输入违反 Core 硬约束，未启动流水线：" + "; ".join(errors),
            stage="INPUT_VALIDATION", task_id=tid, case_id=norm.get("case_id"),
            results={"input_errors": errors},
            input={"normalized": norm},
        )
        # 工程结论语义：校验正确地阻止了计算 → 工具本身执行成功
        env["success"] = True
        env["status"] = "BLOCKED_BY_HARD_CONSTRAINT"
        env["next_actions"] = _next_actions(env, tid)
        taskstore.write_envelope(tid, env)
        return env

    out_root = taskstore.output_dir(tid)
    out_root.mkdir(parents=True, exist_ok=True)
    timer = envelope.Stopwatch()
    try:
        result = engine.run_case(raw, out_root, use_ml=use_ml)
    except Exception as exc:  # noqa: BLE001
        import traceback
        taskstore.set_status(tid, "failed", extra={
            "stage": "PIPELINE", "reason": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc()[-4000:]})
        taskstore.touch_index(tid, norm.get("case_id"), "failed")
        env = envelope.fail(TOOL, "PIPELINE_EXCEPTION", str(exc), exc=exc,
                            stage="PIPELINE", task_id=tid,
                            case_id=norm.get("case_id"),
                            input={"normalized": norm})
        env["elapsed_s"] = timer.elapsed_s
        taskstore.write_envelope(tid, env)
        return env

    package = out_root / str(result.get("case_id") or norm["case_id"])
    taskstore.write_result(tid, result)
    # ---- Phase 1.6：落盘 canonical result（Adapter 层的唯一标准解释）----
    try:
        from .. import canonical as canon_builder
        c = canon_builder.build(package, {"task_id": tid,
                                         "parent_task_id": parent_task_id,
                                         "source": "task"})
        c["artifacts"] = artifacts.collect_artifacts(package)
        taskstore.write_json(tid, "CANONICAL_RESULT.json", c)
    except Exception as exc:  # noqa: BLE001
        import sys as _sys
        print(f"[agent_adapter] canonical build failed: {type(exc).__name__}: {exc}",
              file=_sys.stderr)
    taskstore.set_status(tid, "done", extra={
        "case_id": result.get("case_id") or norm.get("case_id"),
        "status": result.get("status"),
        "package_dir": str(package)})

    taskstore.touch_index(tid, result.get("case_id") or norm.get("case_id"),
                          "done", note=result.get("status"))

    env = envelope.ok(TOOL, task_id=tid, case_id=result.get("case_id"),
                      status=result.get("status"))
    env = _fill_envelope(env, tid, package, norm, result, timer.elapsed_s)
    env["next_actions"] = _next_actions(env, tid)
    taskstore.write_envelope(tid, env)
    return env


# ---------------------------------------------------------------------------
# 后台执行（推荐入口）
# ---------------------------------------------------------------------------
def spawn_background(raw: dict, task_id: str | None = None, use_ml: bool | None = None,
                     parent_task_id: str | None = None) -> dict:
    raw = dict(raw or {})
    norm = engine.normalize_input(raw)
    tid = taskstore.create_task(raw, norm, task_id=task_id,
                               parent_task_id=parent_task_id)

    req_file = taskstore.task_dir(tid) / "REQUEST_RAW.json"
    req_file.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    log = taskstore.log_path(tid)
    log.parent.mkdir(parents=True, exist_ok=True)
    cmd = [config.PYTHON_EXE, "-m", "agent_adapter.cli", "run-analysis",
           "--foreground", "--task-id", tid, "--request-file", str(req_file)]
    if use_ml is False:
        cmd.append("--no-ml")

    creationflags = 0
    if sys.platform == "win32":
        creationflags = (getattr(subprocess, "DETACHED_PROCESS", 0)
                         | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))

    with open(log, "a", encoding="utf-8") as fh:
        fh.write(f"\n=== spawn {envelope.now_iso()} ===\n{' '.join(cmd)}\n")
        extra = config.worker_env()
        prov = config.runtime_provenance()
        fh.write("runtime_provenance: " + json.dumps(prov, ensure_ascii=False) + "\n")
        if extra:
            fh.write("worker_env: " + json.dumps(extra, ensure_ascii=False) + "\n")
        fh.flush()
        env_vars = dict(os.environ)
        env_vars.update(extra)
        env_vars.setdefault("BLAST_AGENT_ORIGIN",
                            prov.get("origin") or "adapter-background")
        proc = subprocess.Popen(
            cmd, cwd=str(config.REPO_ROOT), stdout=fh, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, creationflags=creationflags, close_fds=True,
            env=env_vars)

    taskstore.set_status(tid, "queued", extra={"case_id": norm.get("case_id"),
                                              "pid": proc.pid, "log": str(log)})
    taskstore.touch_index(tid, norm.get("case_id"), "queued")
    return envelope.ok(
        TOOL,
        task_id=tid,
        case_id=norm.get("case_id"),
        status="RUNNING",
        input={"normalized": norm},
        results={
            "mode": "background",
            "pid": proc.pid,
            "log": str(log),
            "poll_with": f"task-status --task-id {tid}",
            "note": ("已启动后台计算（真实流水线，实测约 60 秒以上）。"
                     "请用 task-status 轮询，不要在本次工具调用内等待。"),
        },
        metrics={"use_ml": config.USE_ML if use_ml is None else bool(use_ml)},
        next_actions=[f"task-status --task-id {tid}（每 10~20 秒轮询一次）",
                      "轮询到 phase=done 后执行 get_project_result"],
    )


def run(raw: dict, task_id: str | None = None, background: bool = False,
        use_ml: bool | None = None, parent_task_id: str | None = None) -> dict:
    if background:
        return spawn_background(raw, task_id=task_id, use_ml=use_ml,
                                parent_task_id=parent_task_id)
    return run_foreground(raw, task_id=task_id, use_ml=use_ml,
                          parent_task_id=parent_task_id)


# ---------------------------------------------------------------------------
# 状态查询
# ---------------------------------------------------------------------------
def status(task_id: str | None = None) -> dict:
    tid = task_id
    if not tid:
        latest = taskstore.latest_task()
        if not latest:
            return envelope.fail(TOOL_STATUS, "NO_TASK",
                                 "当前没有任何任务；请先执行 run_project_analysis")
        tid = latest["task_id"]
    st = taskstore.read_status(tid)
    if st is None:
        return envelope.fail(TOOL_STATUS, "TASK_NOT_FOUND",
                             f"未找到 task_id={tid}", task_id=tid)
    phase = st.get("phase")
    running = phase in ("queued", "running")
    pkg = taskstore.package_dir(tid)
    # 运行中现场计算 elapsed；已结束则使用落盘的最终时长（更准确）
    elapsed = st.get("elapsed_s")
    if running and st.get("started_at"):
        try:
            import datetime as _dt
            t0 = _dt.datetime.fromisoformat(st["started_at"])
            elapsed = round((_dt.datetime.now() - t0).total_seconds(), 1)
        except Exception:  # noqa: BLE001
            pass
    if running:
        next_actions = [f"task-status --task-id {tid}（继续轮询，间隔 10~20 秒）"]
    elif phase == "done":
        next_actions = [f"get_project_result --task-id {tid}"]
    else:
        next_actions = [f"查看日志：{st.get('log') or taskstore.log_path(tid)}",
                        "修正问题后重新 run_project_analysis"]
    return envelope.ok(
        TOOL_STATUS,
        task_id=tid,
        case_id=st.get("case_id"),
        status=st.get("status"),
        results={
            "phase": phase,
            "running": running,
            "stage": st.get("stage"),
            "reason": st.get("reason"),
            "log": st.get("log") or str(taskstore.log_path(tid)),
            "package_dir": str(pkg.resolve()) if pkg.is_dir() else None,
            "runtime_provenance": (st.get("runtime_provenance")
                                   or taskstore.read_task_json(tid, "RUNTIME_PROVENANCE.json")),
            "note": ("phase=done 表示生产流水线已完成，可 get_project_result；"
                     "phase=failed 时看 reason 与 log。"),
        },
        metrics={"elapsed_s": elapsed},
        next_actions=next_actions,
    )


