<#
.SYNOPSIS
  Stop UsagePlane: this machine's local dashboard and the hub tunnel.

.DESCRIPTION
  Counterpart to usageplane-on.ps1. Stops only the two processes THIS setup
  starts — the local `usageplane serve` and the SSH tunnel bound to port 7690.
  It deliberately does not touch the hub itself (that keeps running on the VPS)
  and never kills unrelated node/ssh processes.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\usageplane-off.ps1

.NOTES
  The VPS hub is separate — to stop that one too:
    ssh dev@149.104.78.53 "pkill -f 'usageplane.js serve'"
#>
[CmdletBinding()]
param(
  [int]$TunnelPort = 7690,
  [int]$ServePort = 7691
)

$ErrorActionPreference = "Continue"
$LogDir = Join-Path $env:USERPROFILE ".usageplane"
function Write-Step([string]$msg) {
  Write-Host $msg
  Add-Content -Path (Join-Path $LogDir "manual-on.log") -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

$stopped = 0

# Local dashboard: the process listening on ServePort.
$servePids = Get-NetTCPConnection -LocalPort $ServePort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $servePids) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq "node") {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Step "stopped local serve (pid $procId) on :$ServePort"
    $stopped++
  }
}
if ($stopped -eq 0) { Write-Step "local serve was not running on :$ServePort" }

# Tunnel: the ssh process bound to the tunnel port.
$tunnelPids = Get-NetTCPConnection -LocalPort $TunnelPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $tunnelPids) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq "ssh") {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Step "stopped hub tunnel (pid $procId) on :$TunnelPort"
  }
}

# Any leftover -L 7690 ssh forwarders that lost their listener binding.
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$TunnelPort:127.0.0.1*" } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Step "stopped leftover tunnel (pid $($_.ProcessId))"
  }

Write-Host ""
Write-Host "UsagePlane stopped on this machine. The VPS hub is untouched."
