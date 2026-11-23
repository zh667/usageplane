<#
.SYNOPSIS
  Start UsagePlane on demand: hub tunnel + local dashboard + one sync.

.DESCRIPTION
  Nothing runs on a timer anymore. Run this when you actually want to use
  UsagePlane, and everything it needs comes up:

    1. SSH tunnel  localhost:7690 -> hub (VPS 127.0.0.1:7690)
    2. local serve localhost:7691 (this machine's own view)
    3. one `usageplane sync` (collectors -> local db -> auto-push to hub)

  Safe to re-run: it detects an already-open port and skips that step.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\usageplane-on.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\usageplane-on.ps1 -NoSync

.NOTES
  To stop again: .\scripts\usageplane-off.ps1
#>
[CmdletBinding()]
param(
  [string]$HubHost = "149.104.78.53",
  [string]$User = "dev",
  [int]$LocalPort = 7690,
  [int]$ServePort = 7691,
  [int]$RemotePort = 7690,
  [string]$RepoPath = "",
  # The hub key. Verified necessary on this machine: letting ssh fall back to
  # ~/.ssh/id_ed25519 stalls during authentication through the Clash Verge TUN
  # proxy, and the tunnel then never binds. vps_tunnel authenticates reliably.
  [string]$Key = "$env:USERPROFILE\.ssh\vps_tunnel",
  [switch]$NoSync
)

# $PSScriptRoot is not reliably populated during parameter binding, so resolve
# the repo root (this script lives in <repo>/scripts/) after the fact.
if (-not $RepoPath) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoPath = Split-Path -Parent $scriptDir
}

$ErrorActionPreference = "Stop"
$LogDir = Join-Path $env:USERPROFILE ".usageplane"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Test-Port([int]$Port) {
  return [bool](Test-NetConnection -ComputerName "127.0.0.1" -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

# A listening port is NOT proof the tunnel forwards: an SSH forward can stay
# bound with a dead upstream, which is exactly how a sync silently stops
# contributing. Ask the hub a real question instead of trusting the port.
# NOTE: this machine routes the VPS connection through Clash Verge in TUN mode,
# so a hub round trip can take ~8-10s — the timeout must tolerate that.
function Test-Hub([int]$Port) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/summary" -TimeoutSec 30 -UseBasicParsing
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Write-Step([string]$msg) {
  Write-Host $msg
  Add-Content -Path (Join-Path $LogDir "manual-on.log") -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

# --- 1. hub tunnel ---------------------------------------------------------
if (Test-Hub $LocalPort) {
  Write-Step "hub reachable on :$LocalPort — tunnel healthy, skipping"
} else {
  if (Test-Port $LocalPort) {
    # Bound but not answering: a dead forward holding the port. Clear it,
    # otherwise the new tunnel cannot bind and every sync silently fails.
    Write-Step "port $LocalPort is bound but the hub does not answer — clearing the stale tunnel"
    Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq "ssh") { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
      }
    Start-Sleep -Seconds 2
  }
  Write-Step "starting tunnel localhost:$LocalPort -> $User@$HubHost"
  Start-Process -FilePath "ssh" -WindowStyle Hidden -ArgumentList @(
    "-N",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ConnectTimeout=25",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-L", "${LocalPort}:127.0.0.1:${RemotePort}",
    "$User@$HubHost"
  ) | Out-Null
  # Through the proxy the connect + first round trip can take ~10-20s, so poll
  # generously (up to ~60s) rather than declaring failure after a few seconds.
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 5
    if (Test-Hub $LocalPort) { break }
  }
  if (Test-Hub $LocalPort) { Write-Step "tunnel up (hub answered)" }
  else { Write-Step "WARNING: tunnel did not come up — check 'ssh -v $User@$HubHost'" }
  # A just-established forward carries the 1.3MB push body unreliably for the
  # first few seconds; give it a moment before syncing.
  if (Test-Hub $LocalPort) { Start-Sleep -Seconds 4 }
}

# --- 2. local dashboard ----------------------------------------------------
if (Test-Hub $ServePort) {
  Write-Step "local serve already answering on :$ServePort — skipping"
} else {
  Write-Step "starting local serve on $ServePort"
  Start-Process -FilePath "powershell" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-Command",
    "`$env:USAGEPLANE_PORT='$ServePort'; Set-Location -LiteralPath '$RepoPath'; & 'node' 'bin\usageplane.js' 'serve'"
  ) | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    if (Test-Hub $ServePort) { break }
  }
  if (Test-Hub $ServePort) { Write-Step "local serve up" }
  else { Write-Step "WARNING: local serve did not open on $ServePort" }
}

# --- 3. one sync -----------------------------------------------------------
# The push leg sends a ~1.2MB JSON body to the hub. Through a port-forward
# (`ssh -L`) that body stalls and never completes when Clash Verge runs in TUN
# mode (verified: <=128KB forwards fine, 256KB+ hangs; the proxy stalls large
# uploads). The same payload over an ordinary SSH *session* channel transfers
# fine, so on push failure we fall back to running the ingest on the VPS side.
function Invoke-Sync {
  Push-Location -LiteralPath $RepoPath
  try {
    # Pipe to Out-Host so the child's output is written straight through instead
    # of being collected into this function's return value. Without this the
    # caller receives an ARRAY of output lines plus the exit code, and any
    # string element makes `-ne 0` look like a failure even on a clean run.
    & node "bin\usageplane.js" sync 2>&1 | Out-Host
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

# Fallback: ship the push body over the SSH session channel and POST it on the
# hub itself (loopback -> no proxy, no tunnel in the payload path).
function Invoke-PushViaSsh {
  Push-Location -LiteralPath $RepoPath
  try {
    $tmp = Join-Path $env:TEMP "usageplane-push-$PID.json"
    $js = @'
const { loadConfig } = await import('./dist/core/config.js');
const { dataDir, dbPath } = await import('./dist/core/paths.js');
const { Store, MANAGED_STATE_KINDS } = await import('./dist/core/store.js');
const fs = await import('node:fs');
const dir = dataDir(); const cfg = loadConfig(dir);
const store = new Store(dbPath(dir));
const body = { records: store.allRecords(), sessions: store.allSessionRows(),
  state: store.deviceState().filter(r => r.device_id === cfg.device),
  state_device: cfg.device, state_kinds: MANAGED_STATE_KINDS };
store.close();
fs.writeFileSync(process.argv[2], JSON.stringify(body));
console.log(body.records.length);
'@
    $jsPath = Join-Path $env:TEMP "usageplane-mkpush-$PID.mjs"
    Set-Content -Path $jsPath -Value $js -Encoding utf8
    $n = & node $jsPath $tmp 2>&1 | Select-Object -Last 1
    if (-not (Test-Path $tmp)) { Write-Step "fallback: could not build push body"; return 1 }

    $token = $env:USAGEPLANE_HUB_TOKEN
    if (-not $token) { $token = [Environment]::GetEnvironmentVariable("USAGEPLANE_HUB_TOKEN", "User") }
    if (-not $token) { Write-Step "fallback: no hub token available"; return 1 }

    # Stream the body over the SSH session channel; curl runs on the hub.
    $remote = "curl -s -m 180 -X POST -H 'content-type: application/json' -H 'authorization: Bearer $token' --data-binary @- http://127.0.0.1:$RemotePort/api/ingest"
    $result = & cmd /c "ssh -o BatchMode=yes -o ConnectTimeout=25 $User@$HubHost `"$remote`" < `"$tmp`"" 2>&1
    Remove-Item $tmp, $jsPath -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0 -and "$result" -match '"total"') {
      Write-Step "fallback push OK: $result"
      return 0
    }
    Write-Step "fallback push failed: $result"
    return 1
  } finally {
    Pop-Location
  }
}

if ($NoSync) {
  Write-Step "sync skipped (-NoSync)"
} else {
  Write-Step "running sync"
  $syncExit = Invoke-Sync
  if ($syncExit -ne 0) {
    Write-Step "sync exit $syncExit — retrying once"
    Start-Sleep -Seconds 4
    $syncExit = Invoke-Sync
  }
  if ($syncExit -ne 0) {
    Write-Step "sync still failing — falling back to SSH-channel push"
    $syncExit = Invoke-PushViaSsh
  }
  Write-Step "sync finished (exit $syncExit)"
}

Write-Host ""
Write-Host "UsagePlane is up:"
Write-Host "  merged view (hub) : http://127.0.0.1:$LocalPort"
Write-Host "  this machine      : http://127.0.0.1:$ServePort"
Write-Host ""
Write-Host "Stop it again with: powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\usageplane-off.ps1`""
