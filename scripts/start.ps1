param([switch]$Demo,[switch]$Dev)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
$installedNode = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v24.20.0/node.exe'
if (Test-Path -LiteralPath $installedNode) { $nodePath = $installedNode }
if (-not $nodePath) { throw 'Install Node 24 LTS first.' }
$env:PATH = (Split-Path $nodePath -Parent) + ';' + $env:PATH
$startArgs = @('--import','tsx','server/index.ts')
if ($Demo) { $startArgs += '--demo' }
if ($Dev) { $startArgs += '--dev' }
& $nodePath @startArgs
