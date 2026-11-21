$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime.ps1')
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS from nodejs.org, then run setup again.' }
if ([int]((& node --version).TrimStart('v').Split('.')[0]) -lt 22) { throw 'Use Node.js 22.12+ or 24 LTS.' }
New-Item -ItemType Directory -Force .tools, .private | Out-Null
if (-not (Test-Path .tools/package/bin/npm-cli.js)) {
  Invoke-WebRequest 'https://registry.npmjs.org/npm/-/npm-11.6.2.tgz' -OutFile .tools/npm.tgz
  tar -xf .tools/npm.tgz -C .tools
  if ($LASTEXITCODE -ne 0) { throw 'npm extraction failed' }
}
if (Test-Path .private/processes.json) { throw 'Stop the recorded laptop server before running setup.' }
& node .tools/package/bin/npm-cli.js ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
if (-not (Test-Path .env)) { & node scripts/secrets.cjs }
& node .tools/package/bin/npm-cli.js run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
& node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
if (-not (Test-Path .tools/cloudflared.exe)) {
  $release = Invoke-RestMethod 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
  $asset = $release.assets | Where-Object name -eq 'cloudflared-windows-amd64.exe'
  if (-not $asset) { throw 'Official Windows tunnel binary unavailable' }
  Invoke-WebRequest $asset.browser_download_url -OutFile .tools/cloudflared.exe
  if ($asset.digest -and $asset.digest.StartsWith('sha256:')) {
    $actual = (Get-FileHash .tools/cloudflared.exe -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $asset.digest.Substring(7)) { throw 'Tunnel binary checksum mismatch' }
  }
}
& node scripts/build-synthetic.mjs
if ($LASTEXITCODE -ne 0) { throw 'Synthetic demonstration build failed.' }
Write-Host 'Setup complete. Use Truck-Tracking.bat. Private login details are in .private/ACCESS.md.'
