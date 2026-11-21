$ErrorActionPreference='Stop'
$stateFile=Join-Path (Split-Path $PSScriptRoot -Parent) '.private/synthetic-process.json'
if(Test-Path $stateFile) {
 $saved=Get-Content $stateFile -Raw | ConvertFrom-Json
 $process=Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
 if($process) {
  $savedTicks=([DateTimeOffset]$saved.started).UtcDateTime.Ticks
  if($process.StartTime.ToUniversalTime().Ticks -ne $savedTicks){throw 'Recorded process identity differs. No process was stopped.'}
  Stop-Process -Id $saved.pid
  $process.WaitForExit(5000) | Out-Null
 }
 Remove-Item -LiteralPath $stateFile
}
Write-Host 'Synthetic demonstration stopped. Real services were not changed.'
