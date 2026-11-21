$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) { throw 'Install Node.js 24 LTS from nodejs.org, then run setup again.' }
  $env:PATH = (Split-Path $bundledNode -Parent) + [IO.Path]::PathSeparator + $env:PATH
}
