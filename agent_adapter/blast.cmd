@echo off
rem ===========================================================================
rem  blast.cmd — Agent 适配层启动器（固定使用本项目 venv 解释器）
rem
rem  用法（工作目录 = 仓库根）：
rem      agent_adapter\blast.cmd <子命令> [参数...]
rem
rem  为什么需要它：Agent（DeepSeek Harness 的 pwsh 工具）继承的 PATH 未必包含
rem  本项目 venv，直接写 `python` 可能落到另一个解释器（缺少 numpy/ezdxf 等依赖）。
rem  本脚本显式指定 .venv 解释器并设置 PYTHONPATH，行为与手工调用完全一致。
rem  所有计算仍由 51_one_click_end_to_end 生产流水线完成，本层不含任何算法。
rem ===========================================================================
setlocal DisableDelayedExpansion
set "REPO=%~dp0.."
set "PY=%REPO%\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
set "PYTHONPATH=%REPO%"
set "PYTHONIOENCODING=utf-8"
"%PY%" -m agent_adapter.cli %*
exit /b %errorlevel%
