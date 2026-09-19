# -*- coding: utf-8 -*-
"""agent_adapter.cli — 智能体调用入口（stdout 只输出一个 JSON 信封）。

用法示例（由 DeepSeek Harness 的 pwsh 工具调用）：

    python -m agent_adapter.cli doctor
    python -m agent_adapter.cli validate-input --input-file req.json
    python -m agent_adapter.cli run-analysis --task-id Txxxx --foreground --request-file req.json
    python -m agent_adapter.cli task-status --task-id Txxxx
    python -m agent_adapter.cli get-result --task-id Txxxx
    python -m agent_adapter.cli get-result --case-id P0535 --section summary
    python -m agent_adapter.cli compare-results --task-a A --task-b B
    python -m agent_adapter.cli generate-figures --task-id Txxxx --targets plan,3d,charge
    python -m agent_adapter.cli generate-report --task-id Txxxx

约定：
  - stdout 永远是**单个 JSON 对象**（可用 --out 另存文件）；
  - 诊断信息一律进 stderr / 日志文件，绝不出现在 stdout；
  - 退出码：0 成功；3 输入被硬约束阻止；1 其它失败。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # 允许 `python agent_adapter/cli.py` 直接运行
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent_adapter import config, envelope  # noqa: E402
from agent_adapter.services import (  # noqa: E402
    analysis_service, contract_service, doctor_service, figure_service,
    input_service, report_service, result_service,
)


# ---------------------------------------------------------------------------
# 输入读取
# ---------------------------------------------------------------------------
def _read_json_file(path: str) -> dict:
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    return json.loads(p.read_text(encoding="utf-8-sig"))


def parse_input(args) -> dict:
    """支持 --request-file / --input-file / --input-json / stdin 四种来源。"""
    for attr in ("request_file", "input_file"):
        val = getattr(args, attr, None)
        if val:
            return _read_json_file(val)
    val = getattr(args, "input_json", None)
    if val:
        return json.loads(val)
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            return json.loads(raw)
    return {}


def _add_input_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--request-file", default=None, help="原始请求 JSON 文件")
    ap.add_argument("--input-file", default=None, help="输入 JSON 文件（与 --request-file 同义）")
    ap.add_argument("--input-json", default=None, help="内联 JSON 字符串")


# ---------------------------------------------------------------------------
# 命令实现
# ---------------------------------------------------------------------------
def cmd_doctor(args) -> dict:
    return doctor_service.run(with_validate_smoke=not args.no_smoke)


def cmd_validate_input(args) -> dict:
    return input_service.validate(parse_input(args))


def cmd_run_analysis(args) -> dict:
    raw = parse_input(args)
    return analysis_service.run(
        raw, task_id=args.task_id,
        background=not args.foreground,
        use_ml=(False if args.no_ml else None),
        parent_task_id=args.parent_task_id,
    )


def cmd_task_status(args) -> dict:
    return analysis_service.status(args.task_id)


def cmd_get_result(args) -> dict:
    return result_service.get_result(
        task_id=args.task_id, case_id=args.case_id,
        section=args.section, json_name=args.json)


def cmd_canonical_result(args) -> dict:
    return contract_service.canonical_result(
        task_id=args.task_id, case_id=args.case_id,
        with_render=not args.no_render, with_raw=args.with_raw)


def cmd_validate_result_consistency(args) -> dict:
    compare = None
    if args.compare_a or args.compare_b or args.case_a or args.case_b:
        compare = (args.compare_a, args.compare_b, args.case_a, args.case_b)
    return contract_service.validate(task_id=args.task_id, case_id=args.case_id,
                                     compare=compare)



def cmd_list_tasks(args) -> dict:
    return result_service.list_recent(limit=args.limit)


def cmd_compare_results(args) -> dict:
    return result_service.compare(args.task_a or "", args.task_b or "",
                                 case_a=args.case_a, case_b=args.case_b)


def cmd_generate_figures(args) -> dict:
    targets = tuple(t.strip() for t in (args.targets or "plan,3d,charge").split(",") if t.strip())
    return figure_service.generate(task_id=args.task_id, case_id=args.case_id,
                                  targets=targets)


def cmd_generate_report(args) -> dict:
    return report_service.generate(task_id=args.task_id, case_id=args.case_id)


# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="agent_adapter",
        description="立井钻爆设计系统 · Agent 适配层（只搬运，不重算）",
    )
    ap.add_argument("--out", default=None,
                    help="同时把 JSON 信封写到该文件（stdout 仍输出同一份）")
    # 子命令也可用 --out（放到子命令之后同样有效，便于 Agent 书写）
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out", default=None, help=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest="command")

    p = sub.add_parser("doctor", help="环境自检（不跑流水线）", parents=[common])
    p.add_argument("--no-smoke", action="store_true", help="跳过校验冒烟测试")
    p.set_defaults(func=cmd_doctor)

    p = sub.add_parser("validate-input", help="validate_project_input：校验 + 标准化",
                       parents=[common])
    _add_input_args(p)
    p.set_defaults(func=cmd_validate_input)

    p = sub.add_parser("run-analysis", help="run_project_analysis：真实完整方案计算",
                       parents=[common])
    _add_input_args(p)
    p.add_argument("--task-id", default=None, help="指定任务号（不指定则自动生成）")
    p.add_argument("--parent-task-id", default=None, help="父任务号（改参重跑时记录血缘）")
    p.add_argument("--foreground", action="store_true",
                   help="阻塞执行（后台 worker 与调试用；默认后台）")
    p.add_argument("--no-ml", action="store_true",
                   help="装药推荐直接走 STATISTICAL_CBR（默认 HYBRID_ML_CBR，失败自动降级）")
    p.set_defaults(func=cmd_run_analysis)

    p = sub.add_parser("task-status", help="查询后台任务进度", parents=[common])
    p.add_argument("--task-id", default=None, help="省略则取最近一个任务")
    p.set_defaults(func=cmd_task_status)

    p = sub.add_parser("get-result", help="get_project_result：只读读取真实结果",
                       parents=[common])
    p.add_argument("--task-id", default=None)
    p.add_argument("--case-id", default=None, help="历史案例号（如 P0535），只读")
    p.add_argument("--section", default="summary",
                   choices=["summary", "package", "canonical", "render", "explain"])
    p.add_argument("--json", default=None, help="只读取指定 JSON，如 CHARGE_STRUCTURE.json")
    p.set_defaults(func=cmd_get_result)

    p = sub.add_parser("canonical-result",
                       help="Canonical Result Contract：Agent 的唯一标准解释", parents=[common])
    p.add_argument("--task-id", default=None)
    p.add_argument("--case-id", default=None)
    p.add_argument("--no-render", action="store_true", help="不返回确定性展示块")
    p.add_argument("--with-raw", action="store_true", help="附带原始 JSON 包（体积大）")
    p.set_defaults(func=cmd_canonical_result)

    p = sub.add_parser("validate-result-consistency",
                       help="Result Consistency Validator（只读，不修改任何结果）",
                       parents=[common])
    p.add_argument("--task-id", default=None)
    p.add_argument("--case-id", default=None)
    p.add_argument("--compare-a", default=None, help="对比校验：A 侧 task_id")
    p.add_argument("--compare-b", default=None, help="对比校验：B 侧 task_id")
    p.add_argument("--case-a", default=None, help="对比校验：A 侧 case_id")
    p.add_argument("--case-b", default=None, help="对比校验：B 侧 case_id")
    p.set_defaults(func=cmd_validate_result_consistency)

    p = sub.add_parser("list-tasks", help="最近任务列表（会话找回）", parents=[common])
    p.add_argument("--limit", type=int, default=None)
    p.set_defaults(func=cmd_list_tasks)

    p = sub.add_parser("compare-results", help="两个真实方案的字段级对比", parents=[common])
    p.add_argument("--task-a", default=None)
    p.add_argument("--task-b", default=None)
    p.add_argument("--case-a", default=None, help="也可用历史案例号（如 P0535）")
    p.add_argument("--case-b", default=None)
    p.set_defaults(func=cmd_compare_results)

    p = sub.add_parser("generate-figures", help="generate_project_figures：快照重渲染图件",
                       parents=[common])
    p.add_argument("--task-id", default=None)
    p.add_argument("--case-id", default=None)
    p.add_argument("--targets", default="plan,3d,charge",
                   help="逗号分隔：plan,3d,charge")
    p.set_defaults(func=cmd_generate_figures)

    p = sub.add_parser("generate-report", help="generate_project_report：复用真实结果出报告",
                       parents=[common])
    p.add_argument("--task-id", default=None)
    p.add_argument("--case-id", default=None)
    p.set_defaults(func=cmd_generate_report)

    return ap


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    config.ensure_dirs()

    ap = build_parser()
    args = ap.parse_args(argv)
    if not getattr(args, "func", None):
        ap.print_help()
        return 0

    out_path = Path(args.out) if getattr(args, "out", None) else None
    timer = envelope.Stopwatch()
    try:
        env = args.func(args)
    except json.JSONDecodeError as exc:
        env = envelope.fail(args.command, "BAD_JSON", f"输入 JSON 解析失败：{exc}",
                            exc=exc, stage="parse_input")
    except FileNotFoundError as exc:
        env = envelope.fail(args.command, "FILE_NOT_FOUND", str(exc), exc=exc,
                            stage="read_input")
    except Exception as exc:  # noqa: BLE001
        import traceback
        print(traceback.format_exc(), file=sys.stderr)
        env = envelope.fail(args.command, "UNEXPECTED_ERROR", str(exc), exc=exc)

    if env.get("elapsed_s") is None:
        env["elapsed_s"] = timer.elapsed_s
    return envelope.emit(env, out_path)


if __name__ == "__main__":
    raise SystemExit(main())

