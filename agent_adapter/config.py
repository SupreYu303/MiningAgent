# -*- coding: utf-8 -*-
"""agent_adapter.config — 路径与运行参数解析（纯配置，无业务算法）。

纪律：
  - 本包只做「参数进 / JSON 出 / 文件路径传递」，不含任何工程计算；
  - 一切数值来自 51_one_click_end_to_end 生产流水线的真实返回；
  - 默认输出根指向本包 workspace，**不污染** 51/outputs 冻结证据库。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
REPO_ROOT = PACKAGE_DIR.parent

# ---- Core（只读引用，禁止修改） -------------------------------------------
CORE51 = REPO_ROOT / "51_one_click_end_to_end"
CORE52 = REPO_ROOT / "52_gui_v1"
CORE53 = REPO_ROOT / "53_true_3d_dxf"
FROZEN_OUTPUTS = CORE51 / "outputs"          # 既有生产输出（历史案例证据库）

# ---- 适配层运行区 ---------------------------------------------------------
WORKSPACE_DIR = Path(os.environ.get("BLAST_AGENT_WORKSPACE", PACKAGE_DIR / "workspace"))
TASKS_DIR = WORKSPACE_DIR / "tasks"
INDEX_PATH = WORKSPACE_DIR / "index.json"
LOG_DIR = WORKSPACE_DIR / "logs"
SCHEMAS_DIR = PACKAGE_DIR / "schemas"

# ---- 运行参数 -------------------------------------------------------------
PYTHON_EXE = os.environ.get("BLAST_AGENT_PYTHON", sys.executable)

#: 前台单次流水线最长等待（秒）；后台模式由 task-status 轮询，不受此限制影响
DEFAULT_TIMEOUT_S = float(os.environ.get("BLAST_AGENT_TIMEOUT_S", "3600"))

#: 装药推荐是否优先 HYBRID_ML_CBR（与 51 CLI / GUI 的默认一致）
USE_ML = os.environ.get("BLAST_AGENT_USE_ML", "1").strip() not in ("0", "false", "False", "")

#: Phase 6 是否启用 Model6E（生产路径一律 False，与 51 CLI 一致）
USE_6E = os.environ.get("BLAST_AGENT_USE_6E", "0").strip() in ("1", "true", "True")

#: 后台任务轮询建议间隔（秒），供 Skill 文档使用
POLL_INTERVAL_S = float(os.environ.get("BLAST_AGENT_POLL_INTERVAL_S", "10"))

#: 最近任务列表默认条数
DEFAULT_LIST_LIMIT = int(os.environ.get("BLAST_AGENT_LIST_LIMIT", "20"))

#: Phase 1.6 §8：是否让后台 worker 以"单进程/单线程"方式运行数值库
#:   置 1 时注入 LOKY_MAX_CPU_COUNT=1 / JOBLIB_MULTIPROCESSING=0 / OMP_NUM_THREADS=1，
#:   可消除 joblib 的 Windows 物理核探测子进程（powershell.exe）与 ExtraTrees 预测的
#:   线程级浮点抖动（使结果逐字节可复现）。
#:   **默认 0（关闭）**：A/B 实测显示区间边界存在 ≤1 ULP 差异，按"必须完全一致才可改默认"
#:   的纪律，需用户显式确认后才启用。详见 SANDBOX_RUNTIME_DIAGNOSIS.md。
SINGLE_PROCESS_FLAG_RAW = os.environ.get("BLAST_AGENT_SINGLE_PROCESS", "")
SINGLE_PROCESS_NUMERIC = SINGLE_PROCESS_FLAG_RAW.strip() in ("1", "true", "True", "yes")

#: 受限沙箱友好 / 可复现的数值库并行配置（**只影响线程与 joblib 后端，不改任何算法**）。
SINGLE_PROCESS_ENV = {
    "LOKY_MAX_CPU_COUNT": "1",
    "JOBLIB_MULTIPROCESSING": "0",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "OPENBLAS_NUM_THREADS": "1",
}


def apply_single_process_env() -> dict:
    """把单进程配置写进**当前进程**的环境（前台流水线在同一进程内跑，worker_env 管不到它）。

    为什么必须在这里做：`LOKY_MAX_CPU_COUNT` 是 joblib 在**第一次 Parallel 调用时**才读的，
    `OMP_NUM_THREADS` 是 OpenMP 运行时**首次初始化时**才读的；两者都晚于本模块 import。
    因此只要 BLAST_AGENT_SINGLE_PROCESS=1，本模块 import 时（远早于 numpy/joblib）落进
    os.environ，就能同时覆盖「前台 in-process」与「后台 worker 子进程」两条路径。
    已显式设置过的变量不会被覆盖（尊重调用方环境）。
    """
    applied = {}
    for key, value in SINGLE_PROCESS_ENV.items():
        if not os.environ.get(key):
            os.environ[key] = value
            applied[key] = value
    return applied


#: 本模块 import 时实际写入的环境变量（provenance 用）
_APPLIED_SINGLE_PROCESS_ENV = apply_single_process_env() if SINGLE_PROCESS_NUMERIC else {}


def worker_env() -> dict:
    """后台 worker 子进程的附加环境变量（仅影响数值库并行策略，不改任何算法）。"""
    if not SINGLE_PROCESS_NUMERIC:
        return {}
    return dict(SINGLE_PROCESS_ENV)


def runtime_provenance() -> dict:
    """本 Python 计算进程的 runtime provenance（只记录事实，不参与任何计算）。

    用于回答一个问题：**Agent Runtime 侧声明的运行条件，是否真的到达了实际算数值的那个进程。**
    因此这里记录的是「进程自己看到的环境」，不是调用方自称传了什么。
    """
    import datetime as _dt

    origin = os.environ.get("BLAST_AGENT_ORIGIN") or "direct"
    return {
        "schema": "agent_adapter.runtime_provenance.v1",
        "recorded_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "pid": os.getpid(),
        "parent_pid": os.getppid(),
        "python": sys.version.split()[0],
        "python_exe": sys.executable,
        "cwd": os.getcwd(),
        "repo_root": str(REPO_ROOT),
        "argv": [str(a) for a in sys.argv[:12]],
        "origin": origin,
        "origin_detail": os.environ.get("BLAST_AGENT_ORIGIN_DETAIL") or "",
        "single_process": {
            "env_name": "BLAST_AGENT_SINGLE_PROCESS",
            "raw": SINGLE_PROCESS_FLAG_RAW,
            "enabled": SINGLE_PROCESS_NUMERIC,
            "declared_vars": dict(SINGLE_PROCESS_ENV),
            "applied_by_adapter_import": dict(_APPLIED_SINGLE_PROCESS_ENV),
            "effective_in_this_process": {
                key: os.environ.get(key) for key in SINGLE_PROCESS_ENV
            },
        },
        "workspace": str(WORKSPACE_DIR),
    }


def log_provenance_line(task_id: str | None = None) -> dict:
    """把 provenance 写进 adapter 日志（stderr 之外的持久证据），并返回该记录。"""
    import json as _json

    prov = runtime_provenance()
    if task_id:
        prov["task_id"] = task_id
    try:
        ensure_dirs()
        with open(LOG_DIR / "runtime_provenance.jsonl", "a", encoding="utf-8") as fh:
            fh.write(_json.dumps(prov, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001 — provenance 落盘失败绝不阻断计算
        pass
    return prov



def core_import_paths() -> list:
    """Core 包所需的 sys.path 目录（与 51 CLI / gui_worker 的做法一致）。"""
    return [str(CORE51), str(CORE52)]


def ensure_core_paths() -> None:
    for p in core_import_paths():
        if p not in sys.path:
            sys.path.insert(0, p)


def ensure_dirs() -> None:
    for d in (WORKSPACE_DIR, TASKS_DIR, LOG_DIR, SCHEMAS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def describe() -> dict:
    """环境自述（doctor 用；只读检查，不加载模型）。"""
    return {
        "repo_root": str(REPO_ROOT),
        "core51": str(CORE51),
        "core51_exists": CORE51.is_dir(),
        "core51_entry": str(CORE51 / "run_one_click_design.py"),
        "core51_entry_exists": (CORE51 / "run_one_click_design.py").is_file(),
        "frozen_outputs": str(FROZEN_OUTPUTS),
        "frozen_outputs_exists": FROZEN_OUTPUTS.is_dir(),
        "python_exe": PYTHON_EXE,
        "workspace_dir": str(WORKSPACE_DIR),
        "tasks_dir": str(TASKS_DIR),
        "use_ml": USE_ML,
        "use_6e": USE_6E,
        "default_timeout_s": DEFAULT_TIMEOUT_S,
        "single_process": {
            "raw": SINGLE_PROCESS_FLAG_RAW,
            "enabled": SINGLE_PROCESS_NUMERIC,
            "vars": dict(SINGLE_PROCESS_ENV),
            "applied_by_adapter_import": dict(_APPLIED_SINGLE_PROCESS_ENV),
        },
        "runtime_provenance": runtime_provenance(),
    }
