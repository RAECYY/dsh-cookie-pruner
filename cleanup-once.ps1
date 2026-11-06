<#
  cleanup-once.ps1 — 一次性离线清理 DSH 桌面端 dsh-auth-* cookie 库
  ---------------------------------------------------------------
  何时用：
    当 DSH 已经因为 cookie 过多打不开（HTTP 431 / "Web authentication failed"），
    或者运行时清理（插件 dashboard）显示“不可用”时，用这个脚本。

  重要：请先【完全退出 DeepSeek Harness 桌面端】（右下角托盘退出 / 任务栏结束进程），
        否则 Chromium Cookies 库被占用，重命名会失败。
        脚本也会在检测到占用时给出明确报错并退出，不会破坏任何文件。

  作用：把 Chromium 的 Cookies 库重命名为 .bak-<时间戳>，DSH 下次启动会重建一个干净的库。
        旧文件保留为备份，便于极端情况下还原。不会删除任何 asar 或程序文件。
#>

$ErrorActionPreference = 'Stop'

# DSH 桌面端 Chromium 用户数据目录（与视频里“退出应用”后清理一致）
$networkDir = "$env:APPDATA\@deepseek-ai\dsh-desktop\Network"
$cookies = Join-Path $networkDir 'Cookies'
$journal = Join-Path $networkDir 'Cookies-journal'

function Rename-IfExists($path) {
  if (-not (Test-Path $path)) {
    Write-Host "跳过（不存在）: $path"
    return $null
  }
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dest = "$path.bak-$ts"
  try {
    Move-Item -LiteralPath $path -Destination $dest -Force
    Write-Host "已重命名: $path -> $dest"
    return $dest
  } catch {
    Write-Error "无法重命名 $path : $($_.Exception.Message)"
    Write-Error "请确认 DeepSeek Harness 桌面端已【完全退出】（含托盘进程），再重新运行本脚本。"
    exit 1
  }
}

Write-Host "目标目录: $networkDir"
if (-not (Test-Path $networkDir)) {
  Write-Host "目录不存在，无需清理（可能从未启动过桌面端，或路径已变更）。"
  exit 0
}

Rename-IfExists $cookies
Rename-IfExists $journal

Write-Host ""
Write-Host "完成。请重新打开 DeepSeek Harness 桌面端 —— 它会重建干净的 Cookies 库。"
Write-Host "如果仍有问题，可手动删除上面生成的 .bak-* 文件（不影响程序，只是丢失已保存的登录态）。"
