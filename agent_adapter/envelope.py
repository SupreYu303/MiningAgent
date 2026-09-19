# -*- coding: utf-8 -*-
"""agent_adapter.envelope — Agent ↔ Adapter 统一数据契约（唯一出口）。

所有 CLI 命令在 stdout 只输出**一个** JSON 对象，字段固定如下：

    {
      "success": bool,            # 工具本身是否成功执行（与工程结论无关）
      "tool": str,                # 命令名，如 "run_analysis"
      "task_id": str|null,        # 适配层任务号（可被后续命令引用）
      "case_id": str|null,        # 工程案例号
      "status": str|null,         # 四级 FINAL_STATUS（若有）
      "input": {...},             # 原始 + 标准化参数
      "results": {...},           # 关键结构化结果
      "metrics": {...},           # 汇总指标
      "warnings": [str],
      "artifacts": [{"kind","name","path","bytes"}],
      "next_actions": [str],      # 建议的下一步命令（不含任何伪造数值）
      "error": null|{"code","type","message","stage"},
      "elapsed_s": float
    }

约定：`status = BLOCKED_BY_HARD_CONSTRAINT` 时 `success` 仍为 true
（工具正确地完成了校验），工程结论一律由 `status` 字段承载。
"""
from __future__ import annotations

import datetime
import json
import time
from pathlib import Path

ENVELOPE_KEYS = ("success", "tool", "task_id", "case_id", "status", "input",
                 "results", "metrics", "warnings", "artifacts", "next_actions",
                 "error", "elapsed_s")


def new_envelope(tool: str, **kw) -> dict:
    env = {
        "success": False,
        "tool": tool,
        "task_id": None,
        "case_id": None,
        "status": None,
        "input": {},
        "results": {},
        "metrics": {},
        "warnings": [],
        "artifacts": [],
        "next_actions": [],
        "error": None,
        "elapsed_s": None,
    }
    env.update(kw)
    return env


def ok(tool: str, **kw) -> dict:
    kw.setdefault("success", True)
    return new_envelope(tool, **kw)


def fail(tool: str, code: str, message: str, *, exc: BaseException | None = None,
         stage: str | None = None, **kw) -> dict:
    kw.setdefault("success", False)
    kw["error"] = {
        "code": code,
        "type": type(exc).__name__ if exc is not None else None,
        "message": str(message)[:2000],
        "stage": stage,
    }
    return new_envelope(tool, **kw)


def add_artifact(env: dict, path, kind: str) -> None:
    """把磁盘产物加入信封（只登记路径与大小，绝不内联 base64）。"""
    p = Path(path)
    if not p.exists():
        return
    env.setdefault("artifacts", []).append({
        "kind": kind,
        "name": p.name,
        "path": str(p.resolve()),
        "bytes": p.stat().st_size,
    })


def now_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


class Stopwatch:
    def __init__(self):
        self.t0 = time.time()

    @property
    def elapsed_s(self) -> float:
        return round(time.time() - self.t0, 2)


def _json_default(o):
    try:
        import numpy as np
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
    except Exception:  # noqa: BLE001
        pass
    return str(o)


def dump(env: dict, out_path: Path | None = None) -> str:
    """序列化为单个 JSON 文本；可选同时落盘。"""
    text = json.dumps(env, ensure_ascii=False, indent=2, default=_json_default)
    if out_path is not None:
        p = Path(out_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return text


def emit(env: dict, out_path: Path | None = None) -> int:
    """把信封写到 stdout（唯一 JSON），返回进程退出码。"""
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    text = dump(env, out_path)
    sys.stdout.write(text + "\n")
    sys.stdout.flush()
    if env.get("success"):
        return 0
    code = (env.get("error") or {}).get("code")
    return 3 if code in ("BLOCKED_BY_HARD_CONSTRAINT", "INPUT_VALIDATION") else 1
