<#
.SYNOPSIS
  Keeps the UsagePlane hub reachable from Windows: localhost:7690 -> hub 127.0.0.1:7690.

.DESCRIPTION
  The hub binds loopback only (by design — see docs/ARCHITECTURE.md), so satellite
  devices reach it over SSH. Both directions of the merged view depend on this
  tunnel: `usageplane sync` pushes through it (the Claude Stop hook and the Codex
  notify hook call sync, so a dead tunnel silently stops the device from
  contributing) and the browser reads the hub's dashboard through it.

  Run it as a logon task rather than a manual window — a tunnel that only exists
  while a terminal is open is how a device goes stale without anyone noticing.

.EXAMPLE
  # one-time install (runs at every logon, reconnects on drop)
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-tunnel.ps1 -Install

.EXAMPLE
  # is it up? also asks the hub who it is holding data for
  powershell -ExecutionPolicy Bypass -File .\scripts\windows-tunnel.ps1 -Status
#>
[CmdletBinding()]
param(
  [string]$HubHost = "149.104.78.53",
  [string]$User = "dev",
  [int]$LocalPort = 7690,
  [int]$RemotePort = 7690,
  # Empty = let ssh pick the default identity (~/.ssh/id_*). Pass an explicit
  # path when the hub key is not the default one, e.g. ~\.ssh\vps_tunnel.
  [string]$Key = "",
  [int]$RetrySeconds = 10,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status
)

$ErrorActionPreference = "Stop"
$TaskName = "UsagePlane hub tunnel"
$LogDir = Join-Path $env:USERPROFILE ".usageplane"
$LogFile = Join-Path $LogDir "tunnel.log"

function Write-Log {
  param([string]$Message)
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  # The loop runs forever; keep its log from growing without bound.
  if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) {
    $tail = Get-Content $LogFile -Tail 200
    Set-Content -Path $LogFile -Value $tail
  }
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

if ($Install) {
  $argList = @(
    "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-HubHost", $HubHost, "-User", $User,
    "-LocalPort", $LocalPort, "-RemotePort", $RemotePort,
    "-RetrySeconds", $RetrySeconds
  )
  if ($Key) { $argList += @("-Key", "`"$Key`"") }
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($argList -join " ")
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  # No execution time limit: this task is supposed to outlive every session.
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Keeps localhost:$LocalPort pointed at the UsagePlane hub on $HubHost." -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "installed and started: $TaskName"
  Write-Host "log: $LogFile"
  exit 0
}

if ($Uninstall) {
  # Stop first — unregistering does not kill a running instance.
  try { Stop-ScheduledTask -TaskName $TaskName } catch { }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "removed: $TaskName"
  exit 0
}

if ($Status) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "task    : $($task.State), last run $($info.LastRunTime) (result $($info.LastTaskResult))"
  } else {
    Write-Host "task    : not installed (-Install to add it)"
  }
  $up = Test-NetConnection -ComputerName "127.0.0.1" -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue
  Write-Host "port    : localhost:$LocalPort $(if ($up) { 'open' } else { 'closed' })"
  if ($up) {
    try {
      $summary = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/api/summary" -TimeoutSec 5
      Write-Host "hub     : $($summary.device), $($summary.record_count) records"
      foreach ($d in $summary.devices) {
        Write-Host ("  {0,-20} {1,-12} {2} tokens" -f $d.device_id, $d.tool, $d.total_tokens)
      }
    } catch {
      Write-Host "hub     : port open but no answer — is something else on $LocalPort ?"
    }
  }
  Write-Host "log     : $LogFile"
  exit 0
}

$sshArgs = @()
if ($Key) { $sshArgs += @("-i", $Key) }
$sshArgs += @(
  "-N",
  # Fail loudly instead of sitting on a connection that forwards nothing.
  "-o", "ExitOnForwardFailure=yes",
  # Detect a dropped link (sleep/roaming) in ~90s instead of hanging forever.
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "StrictHostKeyChecking=accept-new",
  # Never prompt: this runs in a hidden window, and the hub is key-only anyway.
  "-o", "BatchMode=yes",
  "-L", "${LocalPort}:127.0.0.1:${RemotePort}",
  "$User@$HubHost"
)

Write-Log "tunnel start: localhost:$LocalPort -> $User@$HubHost (hub 127.0.0.1:$RemotePort)"
while ($true) {
  $startedAt = Get-Date
  & ssh @sshArgs
  $code = $LASTEXITCODE
  $lasted = [int]((Get-Date) - $startedAt).TotalSeconds
  Write-Log "tunnel closed after ${lasted}s (ssh exit $code) — retrying in ${RetrySeconds}s"
  if ($lasted -lt 5) {
    # Instant exit is almost never the network: it is a busy local port
    # (a local `usageplane serve` on the same number) or an auth failure.
    Write-Log "  hint: is localhost:$LocalPort already taken (local serve?) or the key unusable? try -Status"
  }
  Start-Sleep -Seconds $RetrySeconds
}
