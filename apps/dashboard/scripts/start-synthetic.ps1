param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$stateFile=Join-Path (Get-Location) '.private/synthetic-process.json'
$ready=$false
if(Test-Path $stateFile) {
 $saved=Get-Content $stateFile -Raw | ConvertFrom-Json
 $process=Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
 if($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$saved.started).UtcDateTime.Ticks) {
  try {$health=Invoke-RestMethod 'http://127.0.0.1:3001/health';$ready=$health.mode -eq 'synthetic'}catch{}
  if(-not $ready){throw 'Recorded synthetic process exists but health failed. Stop it with stop-synthetic.ps1 first.'}
 }
}
if(-not $ready) {
 if(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue){throw 'Port 3001 is already occupied by a process not matched to this launcher. Refusing to overwrite its state.'}
 if(-not(Test-Path 'output/synthetic-dist/index.html')){throw 'Build the synthetic frontend before starting it.'}
 New-Item -ItemType Directory -Force .private | Out-Null
 $process=Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts/synthetic-server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput .private/synthetic.log -RedirectStandardError .private/synthetic-error.log
 @{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content $stateFile
 for($i=0;$i -lt 25;$i++) {$process.Refresh();if($process.HasExited){throw 'Synthetic process exited during startup; read .private/synthetic-error.log.'};try {$health=Invoke-RestMethod 'http://127.0.0.1:3001/health';if($health.mode -eq 'synthetic'){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 200}
 if(-not $ready){throw 'Synthetic demo failed to start; see .private/synthetic-error.log.'}
}
Write-Host 'Synthetic demonstration: http://localhost:3001/truck-tracking/ (no login, no hardware)'
if(-not $NoBrowser){Start-Process 'http://localhost:3001/truck-tracking/'}
