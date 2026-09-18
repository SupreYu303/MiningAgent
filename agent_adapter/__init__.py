# -*- coding: utf-8 -*-
"""agent_adapter — 立井钻爆设计系统的 Agent 适配层。

定位（严格遵守）：
    本包只做「搬运与整形」：参数进 → 调用既有生产流水线 → 结构化 JSON 出 → 文件路径传递。
    它**不含任何工程算法**，也**不修改** 51_one_click_end_to_end 及任何既有核心代码。

对外能力（见 cli.py）：
    doctor                 环境自检
    validate-input         validate_project_input
    run-analysis           run_project_analysis（唯一重算入口）
    task-status            长任务轮询
    get-result             get_project_result（只读）
    list-tasks             会话任务找回
    compare-results        compare_project_results（纯 diff）
    generate-figures       generate_project_figures（快照重渲染）
    generate-report        generate_project_report（复用 Core 报告生成）
"""

__all__ = ["config", "envelope", "engine", "taskstore", "artifacts"]
__version__ = "1.0.0"
