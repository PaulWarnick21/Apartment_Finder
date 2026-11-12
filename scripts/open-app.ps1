param([switch]$NoBrowser, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $projectRoot 'data/launcher'
$pidFile = Join-Path $runtimeDir 'server.json'
$appUrl = 'http://127.0.0.1:4317'
$dataPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'data/live')).ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
try { $workspaceId = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataPath))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }

function Get-AppHealth {
    try {
        $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($health.app -eq 'apartment-finder' -and $health.demo -eq $false -and $health.workspaceId -eq $workspaceId) { return $health }
    } catch { }
    return $null
}

function Get-OwnedServer {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $saved = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $candidate = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq 'node' -and $candidate.StartTime.ToUniversalTime().Ticks.ToString() -eq $saved.startTicks) { return $candidate }
    return $null
}

try {
    if ($Stop) {
        $owned = Get-OwnedServer
        if (-not $owned) { Write-Output 'No app server started by this launcher is running.'; exit 0 }
        if (-not (Get-AppHealth)) { throw 'Could not verify this app server. It was left running.' }
        $state = Invoke-RestMethod -Uri "$appUrl/api/state" -TimeoutSec 3
        if (@($state.plans | Where-Object { $_.state -in @('running','approved') }).Count -gt 0) { throw 'A scan is active or approved. Cancel it in Activity before stopping the app.' }
        Stop-Process -Id $owned.Id
        Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
        Write-Output 'Apartment Finder stopped. Your saved apartments and notes are kept.'
        exit 0
    }

    if (-not (Get-AppHealth)) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) { throw 'The app needs a build. Ask Codex to build Apartment Finder.' }
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/tsx'))) { throw 'App dependencies are missing. Ask Codex to restore the dependencies.' }
        $nodePath = Join-Path $env:LOCALAPPDATA 'Author Software/nvm/installs/v24.20.0/node.exe'
        if (-not (Test-Path -LiteralPath $nodePath)) {
            $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
            if (-not $nodeCommand) { throw 'Node 24 is required. Ask Codex to repair the local runtime.' }
            $nodePath = $nodeCommand.Source
        }
        $version = & $nodePath --version
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'Node 24 is required. Ask Codex to repair the local runtime.' }
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        # Double-clicking twice must not start competing copies of the server.
        $lock = $null
        try {
            for ($attempt=0; $attempt -lt 40; $attempt++) {
                try { $lock = [IO.File]::Open((Join-Path $runtimeDir 'launch.lock'), 'OpenOrCreate', 'ReadWrite', 'None'); break }
                catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
            }
            if (-not $lock) { throw 'The app is already starting. Try again in a few seconds.' }
            if (-not (Get-AppHealth)) {
                $env:PORT = '4317'
                $server = Start-Process -FilePath $nodePath -ArgumentList @('--import','tsx','server/index.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'server.log') -RedirectStandardError (Join-Path $runtimeDir 'server-error.log')
                $ready = $false
                for ($attempt=0; $attempt -lt 40; $attempt++) {
                    if (Get-AppHealth) { $ready=$true; break }
                    $server.Refresh()
                    if ($server.HasExited) { break }
                    Start-Sleep -Milliseconds 250
                }
                if (-not $ready) {
                    $server.Refresh()
                    if (-not $server.HasExited) { Stop-Process -Id $server.Id }
                    throw "The app could not start. Details are in $runtimeDir\server-error.log. Another app may be using port 4317."
                }
                @{pid=$server.Id; startTicks=$server.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
            }
        } finally { if ($lock) { $lock.Dispose() } }
    }
    if (-not $NoBrowser) { Start-Process $appUrl }
    Write-Output "Apartment Finder is ready: $appUrl"
} catch {
    if (-not $NoBrowser) {
        Add-Type -AssemblyName System.Windows.Forms
        [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Apartment Finder', 'OK', 'Error') | Out-Null
    }
    Write-Error $_.Exception.Message
    exit 1
}
