# -*- coding: utf-8 -*-
"""agent_adapter.artifacts — 输出包只读解析与产物清单（无任何重算）。

严格纪律：
  1. 只读取生产流水线已落盘的 JSON 文件；
  2. 不重新计算、不取值改写、不补造缺失字段；
  3. 传给 Agent 的永远是**磁盘绝对路径**，不内联二进制。
"""
from __future__ import annotations

import json
from pathlib import Path

#: 输出包中解析粒度所需的 JSON 文件（全部来自 51 的真实产物）
DATA_FILES = {
    "input": "INPUT.json",
    "recommendation": "RECOMMENDATION_RESULT.json",
    "canonical_geometry": "CANONICAL_GEOMETRY.json",
    "current_design": "CURRENT_DESIGN.json",
    "geometry": "GEOMETRY.json",
    "geometry_snapshot": "GEOMETRY_SNAPSHOT.json",
    "charge_recommendation": "CHARGE_RECOMMENDATION.json",
    "joint_calibration": "JOINT_CALIBRATION.json",
    "charge_structure": "CHARGE_STRUCTURE.json",
    "engineering_qc": "ENGINEERING_QC.json",
    "final_status": "FINAL_STATUS.json",
    "error_report": "ERROR_REPORT.json",
}

KIND_BY_SUFFIX = {
    ".png": "figure", ".jpg": "figure", ".jpeg": "figure", ".webp": "figure",
    ".svg": "vector", ".pdf": "document", ".dxf": "cad",
    ".csv": "table", ".xlsx": "table",
    ".md": "report", ".json": "data", ".txt": "text",
}

LABEL_CN = {
    "figure": "图片", "vector": "矢量图", "document": "PDF 文档", "cad": "CAD 图纸",
    "table": "数据表", "report": "报告", "data": "数据文件", "text": "文本",
}


def read_json(out_dir, name: str, default=None):
    """安全读取输出包中的单个 JSON（不存在/损坏 → default）。"""
    p = Path(out_dir) / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def load_package(out_dir) -> dict:
    """一次性读取全部已落盘 JSON（缺哪个就少哪个，绝不补造）。"""
    d = Path(out_dir)
    return {key: read_json(d, fname) for key, fname in DATA_FILES.items()}


def ready_fields(out_dir) -> dict:
    """哪些数据段已就绪 —— 供 Agent 自检，避免引用不存在字段。"""
    d = Path(out_dir)
    return {key: (d / fname).is_file() for key, fname in DATA_FILES.items()}


def collect_artifacts(out_dir) -> list:
    """列出输出包全部文件（绝对路径 + 字节数 + 中文类别），供 UI 直接打开/预览。"""
    d = Path(out_dir)
    if not d.is_dir():
        return []
    rows = []
    for p in sorted(d.iterdir()):
        if not p.is_file():
            continue
        kind = KIND_BY_SUFFIX.get(p.suffix.lower(), "other")
        rows.append({
            "kind": kind,
            "kind_cn": LABEL_CN.get(kind, "其他"),
            "name": p.name,
            "path": str(p.resolve()),
            "bytes": p.stat().st_size,
        })
    return rows


def report_path(out_dir) -> Path:
    return Path(out_dir) / "ONE_CLICK_REPORT.md"


def snapshot(out_dir) -> dict | None:
    """几何快照（图件重渲染的输入；不含 _lay 私有字段）。"""
    return read_json(out_dir, "GEOMETRY_SNAPSHOT.json")


def charge_structure(out_dir) -> dict | None:
    return read_json(out_dir, "CHARGE_STRUCTURE.json")


def final_status(out_dir) -> dict | None:
    return read_json(out_dir, "FINAL_STATUS.json")
