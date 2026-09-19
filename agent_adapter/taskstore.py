# -*- coding: utf-8 -*-
"""agent_adapter.taskstore — 适配层任务台账（纯文件读写，无工程计算）。

作用：给"刚才那个""再跑一次""和上一版比较"提供**可寻址的稳定引用**。
真正的多轮对话上下文由 DeepSeek Harness 的 session 持久化承担，本模块只补
一层轻量台账，不重复实现会话系统。

目录：
    workspace/
    ├── index.json                 # task_id → 概要
    ├── logs/<task_id>.log         # 后台任务 stdout/stderr
    └── tasks/<task_id>/
        ├── REQUEST.json           # 原始请求（未归一化）
        ├── INPUT.json             # 归一化输入（Core 口径，含 _units）
        ├── STATUS.json            # queued|running|done|failed
        ├── AGENT_RESULT.json      # pipeline 返回的完整 result（default=str）
        ├── envelope.json          # 最近一次工具信封
        └── output/                # pipeline 真实输出包（26 文件）
"""
from __future__ import annotations

import json
import os
import random
import string
import datetime
import time
from pathlib import Path

from . import config


# ---------------------------------------------------------------------------
# 基础读写
# ---------------------------------------------------------------------------
def _read_json(path: Path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def _write_json(path: Path, obj) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str),
                   encoding="utf-8")
    for attempt in range(10):
        try:
            os.replace(tmp, p)
            return
        except (PermissionError, OSError):
            time.sleep(0.05 * (attempt + 1))
    tmp.replace(p)


def new_task_id(case_id: str = "") -> str:
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    rand = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(4))
    tag = "".join(ch for ch in str(case_id or "")
                  if ch.isalnum() or ch in "_-")[:24]
    return f"T{stamp}_{tag}_{rand}" if tag else f"T{stamp}_{rand}"


def task_dir(task_id: str) -> Path:
    return config.TASKS_DIR / task_id


def output_dir(task_id: str) -> Path:
    return task_dir(task_id) / "output"


def package_dir(task_id: str) -> Path:
    """真实输出包目录。

    Core 的 `OneClickPipeline.run(raw, out_root)` 会把产物写到 `out_root/<case_id>/`，
    因此适配层把 out_root 指向 `tasks/<tid>/output`，输出包实际位于
    `tasks/<tid>/output/<case_id>/`。本函数负责稳定地解析该目录：
      1) 优先用 STATUS.json 中记录的 package_dir（运行后写入，最可靠）；
      2) 否则若 output 下只有一个子目录，取该子目录；
      3) 兜底返回 output 目录本身（例如早期/异常落盘形态）。
    """
    st = read_status(task_id) or {}
    recorded = st.get("package_dir")
    if recorded and Path(recorded).is_dir():
        return Path(recorded)
    base = output_dir(task_id)
    if base.is_dir():
        subs = [p for p in base.iterdir() if p.is_dir()]
        if len(subs) == 1:
            return subs[0]
    return base



def log_path(task_id: str) -> Path:
    return config.LOG_DIR / f"{task_id}.log"


# ---------------------------------------------------------------------------
# 任务生命周期
# ---------------------------------------------------------------------------
def create_task(raw_request: dict, normalized_input: dict, task_id: str | None = None,
                parent_task_id: str | None = None) -> str:
    config.ensure_dirs()
    tid = task_id or new_task_id(str(normalized_input.get("case_id") or ""))
    d = task_dir(tid)
    d.mkdir(parents=True, exist_ok=True)
    _write_json(d / "REQUEST.json", {
        "raw_request": raw_request,
        "parent_task_id": parent_task_id,
        "created_at": datetime.datetime.now().isoformat(timespec="seconds"),
    })
    _write_json(d / "INPUT.json", normalized_input)
    output_dir(tid).mkdir(parents=True, exist_ok=True)
    set_status(tid, "queued", extra={"case_id": normalized_input.get("case_id")})
    touch_index(tid, normalized_input.get("case_id"), "queued",
                parent_task_id=parent_task_id)
    return tid


def set_status(task_id: str, phase: str, *, extra: dict | None = None) -> dict:
    st = read_status(task_id) or {}
    st.update({
        "task_id": task_id,
        "phase": phase,
        "updated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "pid": os.getpid(),
    })
    if phase == "running" and "started_at" not in st:
        st["started_at"] = st["updated_at"]
    if phase in ("done", "failed") and "finished_at" not in st:
        st["finished_at"] = st["updated_at"]
    if extra:
        st.update({k: v for k, v in extra.items() if v is not None})
    if st.get("started_at"):
        try:
            t0 = datetime.datetime.fromisoformat(st["started_at"])
            st["elapsed_s"] = round((datetime.datetime.now() - t0).total_seconds(), 1)
        except Exception:  # noqa: BLE001
            pass
    _write_json(task_dir(task_id) / "STATUS.json", st)
    return st


def read_status(task_id: str) -> dict | None:
    return _read_json(task_dir(task_id) / "STATUS.json")


def read_input(task_id: str) -> dict | None:
    return _read_json(task_dir(task_id) / "INPUT.json")


def read_result(task_id: str) -> dict | None:
    return _read_json(task_dir(task_id) / "AGENT_RESULT.json")


def read_request(task_id: str) -> dict | None:
    return _read_json(task_dir(task_id) / "REQUEST.json")


def write_result(task_id: str, result: dict) -> None:
    _write_json(task_dir(task_id) / "AGENT_RESULT.json", result)


def write_envelope(task_id: str, env: dict) -> None:
    _write_json(task_dir(task_id) / "envelope.json", env)


def write_json(task_id: str, name: str, obj) -> None:
    """把任意 JSON 写入任务目录（canonical result 等 Adapter 侧产物）。"""
    _write_json(task_dir(task_id) / name, obj)


def read_task_json(task_id: str, name: str):
    return _read_json(task_dir(task_id) / name)



def read_envelope(task_id: str) -> dict | None:
    return _read_json(task_dir(task_id) / "envelope.json")


# ---------------------------------------------------------------------------
# 索引
# ---------------------------------------------------------------------------
def _load_index() -> dict:
    idx = _read_json(config.INDEX_PATH, default=None)
    if not isinstance(idx, dict):
        idx = {"schema": "agent_adapter.index.v1", "tasks": []}
    idx.setdefault("tasks", [])
    return idx


def touch_index(task_id: str, case_id: str | None, phase: str,
                parent_task_id: str | None = None, note: str | None = None) -> None:
    config.ensure_dirs()
    idx = _load_index()
    prev = next((r for r in idx["tasks"] if r.get("task_id") == task_id), {})
    rows = [r for r in idx["tasks"] if r.get("task_id") != task_id]
    rows.insert(0, {
        "task_id": task_id,
        "case_id": case_id or prev.get("case_id"),
        "phase": phase,
        "parent_task_id": (parent_task_id if parent_task_id is not None
                           else prev.get("parent_task_id")),
        "note": note if note is not None else prev.get("note"),
        "out_dir": str(output_dir(task_id)),
        "updated_at": datetime.datetime.now().isoformat(timespec="seconds"),
    })
    idx["tasks"] = rows
    _write_json(config.INDEX_PATH, idx)


def list_tasks(limit: int | None = None) -> list:
    """列出最近任务；phase/elapsed 以磁盘 STATUS.json 为准（后台进程可能已更新）。"""
    idx = _load_index()
    rows = idx.get("tasks", [])
    for r in rows:
        st = read_status(r.get("task_id", ""))
        if st and st.get("phase"):
            r["phase"] = st["phase"]
            r["elapsed_s"] = st.get("elapsed_s")
    return rows[: (limit or config.DEFAULT_LIST_LIMIT)]


def latest_task() -> dict | None:
    rows = list_tasks(limit=1)
    return rows[0] if rows else None


def find_task_by_case(case_id: str, phases=("done",)) -> dict | None:
    for r in list_tasks(limit=10 ** 6):
        if str(r.get("case_id")) == str(case_id) and (not phases or r.get("phase") in phases):
            return r
    return None


# ---------------------------------------------------------------------------
# 历史（冻结）案例只读定位
# ---------------------------------------------------------------------------
def frozen_case_dir(case_id: str) -> Path | None:
    """在 51/outputs 冻结证据库中定位历史案例输出目录（**只读**，不写入）。"""
    d = config.FROZEN_OUTPUTS / str(case_id)
    return d if d.is_dir() else None


