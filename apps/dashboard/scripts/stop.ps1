$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .private/processes.json)) { Write-Host 'No recorded processes'; return }
$state = Get-Content .private/processes.json -Raw | ConvertFrom-Json
foreach ($kind in @('tunnel','server')) {
  $processId = $state."${kind}Pid"
  $expectedStart = $state."${kind}Start"
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      if ($process.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$expectedStart).UtcDateTime.Ticks) { throw 'Recorded process identity changed; no unrelated process was stopped.' }
      Stop-Process -Id $processId
      $process.WaitForExit(5000) | Out-Null
    }
  }
}
Remove-Item -LiteralPath .private/processes.json
Write-Host 'Recorded laptop server and tunnel stopped. Phone sharing must be stopped on the phone.'
