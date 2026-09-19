# -*- coding: utf-8 -*-
"""agent_adapter.services — 工具服务层（每个模块对应一个 Agent 工具）。

共同纪律：
  - 只读或只调用既有 Core；不重实现任何工程计算；
  - 返回值一律为 agent_adapter.envelope 标准信封；
  - 所有数值/结论必须能追溯到 51_one_click_end_to_end 的真实产物或真实接口返回。
"""

__all__ = [
    "input_service", "analysis_service", "result_service",
    "figure_service", "report_service", "doctor_service",
]
