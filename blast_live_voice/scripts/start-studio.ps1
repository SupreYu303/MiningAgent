<#
  start-studio.ps1 —— 冷启动正式 BLAST Studio 并自检 Live Voice。

  纪律（§8 冷启动问题）：
    * profile id 只有一个来源 —— lib/studio.mjs 的 STUDIO_PROFILE_ID；
      本脚本用 node 读它，任何地方都不再手写 profile 名（POC 时代
      process name / display name / profile id 混用的教训）。
    * 不写任何 profile 配置：只启动/停止进程、读 HTTP 事实。

  用法：
    powershell -File blast_live_voice/scripts/start-studio.ps1            # 只探测（不重启）
    powershell -File blast_live_voice/scripts/start-studio.ps1 -Restart   # 真正冷启动（关掉再起）
    powershell -File blast_live_voice/scripts/start-studio.ps1 -Restart -Cdp   # 附带给 9223 调试口（自动化验收用）
    powershell -File blast_live_voice/scripts/start-studio.ps1 -CheckOnly # 只跑自检并打印结果
#>
[CmdletBinding()]
param(
  [switch]$Restart,
  [switch]$Cdp,
  [switch]$CheckOnly,
  [int]$Port = 0,
  [int]$TimeoutSec = 90,
  # 不写死本机安装路径：从环境变量取，未设置时给出明确报错（公开版同样可用）。
  [string]$Exe = $env:DSH_DESKTOP_EXE,
  [string]$CdpPort = '9223'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$pkgRoot = Split-Path -Parent $here

# ── 唯一来源：lib/studio.mjs ────────────────────────────────────────────────
$facts = & node -e "import('file:///$($pkgRoot -replace '\\','/')/lib/studio.mjs').then(m => console.log(JSON.stringify({ profile: m.STUDIO_PROFILE_ID, preset: m.STUDIO_PRESET_ID, home: m.studioHome, port: m.STUDIO_WEB_PORT, gate: m.gateBaseUrl() })))"
if (-not $facts) { throw 'cannot read lib/studio.mjs (profile id source of truth)' }
$meta = $facts | ConvertFrom-Json
if ($Port -le 0) { $Port = [int]$meta.port }
Write-Host "profile=$($meta.profile) preset=$($meta.preset) home=$($meta.home) port=$Port"
Write-Host "gate=$($meta.gate)"

function Get-StudioBase { "http://127.0.0.1:$Port" }

function Wait-Studio {
  param([int]$Seconds)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri ((Get-StudioBase) + '/') -UseBasicParsing -TimeoutSec 4
      if ($r.StatusCode -eq 200) { return $true }
    } catch {
      # DSH Desktop 只服务自己的渲染进程（DesktopWebServer.permits）：裸 loopback 请求会被
      # 403 拒绝。403 恰恰说明「服务已经起来了」——就绪判据因此接受任何 HTTP 响应。
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 403) { return $true }
    }
    Start-Sleep -Milliseconds 1200
  }
  return $false
}

if ($Restart) {
  $running = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host "stopping DSH Desktop (cold start)"
    $running | Stop-Process -Force
    Start-Sleep -Seconds 4
  }
  if ([string]::IsNullOrWhiteSpace($Exe)) {
    throw "DSH Desktop path not set. 用 -Exe '<DSH Desktop.exe 路径>' 或设置环境变量 DSH_DESKTOP_EXE。"
  }
  if (-not (Test-Path $Exe)) { throw "DSH Desktop not found at $Exe" }
  $appArgs = @()
  if ($Cdp) { $appArgs += "--remote-debugging-port=$CdpPort" }
  Write-Host "starting $Exe $($appArgs -join ' ')"
  if ($appArgs.Count -gt 0) {
    Start-Process -FilePath $Exe -ArgumentList $appArgs | Out-Null
  } else {
    Start-Process -FilePath $Exe | Out-Null
  }
  if (-not (Wait-Studio -Seconds $TimeoutSec)) { Write-Host "WARNING: studio web UI not answering on $Port within ${TimeoutSec}s" }
  else { Write-Host "studio READY at $(Get-StudioBase)/" }
}

if ($CheckOnly -or -not $Restart) {
  if (-not (Wait-Studio -Seconds 8)) { Write-Host "studio NOT answering on $Port (可能尚未启动；用 -Restart)" }
}

# ── 自检：Live Voice 的三个服务端事实 ───────────────────────────────────────
function Try-Json($url) {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8).Content | ConvertFrom-Json } catch { return $null }
}

$live = Try-Json ("$(Get-StudioBase)/blast-live-voice/live")
if ($live) {
  Write-Host "live route      : ok=$($live.ok) voiceInstalled=$($live.voice.installed) callActive=$($live.voice.active) gate=$($live.gate.status)"
} else {
  Write-Host 'live route      : NOT AVAILABLE（blast-live-voice 未挂载或尚未启动）'
}
$realtime = Try-Json ("$(Get-StudioBase)/plugins/realtime-voice/v1/status")
if ($realtime) {
  Write-Host "realtime status : protocol=$($realtime.protocol) active=$($realtime.active)"
} else {
  Write-Host 'realtime status : NOT AVAILABLE（@harness-remote/dsh-realtime-voice 未挂载）'
}
Write-Host 'done.'
