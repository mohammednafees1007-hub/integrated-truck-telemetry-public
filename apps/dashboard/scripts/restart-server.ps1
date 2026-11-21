$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
$state = Get-Content .private/processes.json -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.serverPid -ErrorAction SilentlyContinue
if ($process -and $process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$state.serverStart).UtcDateTime.Ticks) { throw 'Recorded server identity changed; refusing to stop unrelated process' }
if ($process) { Stop-Process -Id $process.Id }
$nodePath = (Get-Command node).Source
$server = Start-Process -FilePath $nodePath -ArgumentList 'dist/server.cjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru -RedirectStandardOutput .private/server.log -RedirectStandardError .private/server-error.log
$state.serverPid=$server.Id; $state.serverStart=$server.StartTime.ToUniversalTime().ToString('o')
$state | ConvertTo-Json | Set-Content .private/processes.json
Write-Host 'Backend restarted; existing tunnel hostname retained.'
