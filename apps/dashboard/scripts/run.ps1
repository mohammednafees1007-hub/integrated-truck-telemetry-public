$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .env) -or -not (Test-Path dist/server.cjs)) { throw 'Run scripts/setup.ps1 first' }
New-Item -ItemType Directory -Force .private | Out-Null
if (Test-Path .private/processes.json) { throw 'A run is already recorded. Run scripts/stop.ps1 before restarting.' }
$portLine = Get-Content .env | Where-Object { $_ -match '^PORT=' }
$serverPort = if ($portLine) { ($portLine -split '=',2)[1] } else { '3000' }
$nodePath = (Get-Command node).Source
$server = Start-Process -FilePath $nodePath -ArgumentList 'dist/server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput .private/server.log -RedirectStandardError .private/server-error.log
$state = @{ serverPid=$server.Id; serverStart=$server.StartTime.ToUniversalTime().ToString('o') }
$state | ConvertTo-Json | Set-Content .private/processes.json
$ready = $false
for ($attempt=0; $attempt -lt 30; $attempt++) {
  try { $health = Invoke-RestMethod "http://127.0.0.1:$serverPort/truck-tracking/pi-gps/health.php"; if ($health.status -eq 'ready') { $ready=$true; break } } catch { Start-Sleep -Milliseconds 400 }
}
if (-not $ready) { throw 'Server failed to start. Read .private/server-error.log; run stop.ps1 before retrying.' }
# Authentication tests must pass before any public exposure.
try { Invoke-WebRequest "http://127.0.0.1:$serverPort/truck-tracking/api/pi/latest" | Out-Null; throw 'Unauthenticated read unexpectedly succeeded' } catch { if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw } }
$tunnel = Start-Process -FilePath (Join-Path (Get-Location) '.tools/cloudflared.exe') -ArgumentList @('tunnel','--url',"http://127.0.0.1:$serverPort",'--no-autoupdate') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput .private/tunnel-out.log -RedirectStandardError .private/tunnel.log
$state.tunnelPid=$tunnel.Id; $state.tunnelStart=$tunnel.StartTime.ToUniversalTime().ToString('o')
$state | ConvertTo-Json | Set-Content .private/processes.json
$origin = $null
for ($attempt=0; $attempt -lt 60; $attempt++) {
  $logs = (Get-Content .private/tunnel.log -Raw -ErrorAction SilentlyContinue) + (Get-Content .private/tunnel-out.log -Raw -ErrorAction SilentlyContinue)
  if ($logs -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $origin=$Matches[0]; break }
  Start-Sleep -Milliseconds 500
}
if (-not $origin) { throw 'No tunnel URL yet. Check .private/tunnel.log; laptop server is still running.' }
& node scripts/origin.cjs $origin
# Reload origin for authenticated phone setup without restarting the tunnel.
Stop-Process -Id $server.Id
$server = Start-Process -FilePath $nodePath -ArgumentList 'dist/server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput .private/server.log -RedirectStandardError .private/server-error.log
$state.serverPid=$server.Id; $state.serverStart=$server.StartTime.ToUniversalTime().ToString('o');$state.publicOrigin=$origin
$state | ConvertTo-Json | Set-Content .private/processes.json
Write-Host "Dashboard: $origin/truck-tracking/"
Write-Host "APK: $origin/truck-tracking/pi-gps/PiGPS.apk"
Write-Host 'Private pairing: .private/PHONE_PAIRING.html. Keep laptop awake and online. Stop using scripts/stop.ps1.'
