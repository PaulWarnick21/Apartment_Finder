$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path $PSScriptRoot -Parent
$scanShell = (Get-Process -Id $PID).Path
$scanScript = Join-Path $PSScriptRoot 'keep-discovery-running.ps1'
$scanOutput = Join-Path $scanRoot 'data/launcher'
try {
 $scanExisting = [Threading.Mutex]::OpenExisting('Local\ApartmentFinderScheduledHost')
 try { if (-not $scanExisting.WaitOne(0)) { Write-Output 'Scheduled app host is already running.'; exit 0 }; $scanExisting.ReleaseMutex() } finally { $scanExisting.Dispose() }
} catch [Threading.WaitHandleCannotBeOpenedException] { }
# A named mutex in the host prevents duplicate supervisors, including across logon launches.
Start-Process -FilePath $scanShell -ArgumentList @('-NoProfile','-File',('"' + $scanScript + '"')) -WorkingDirectory $scanRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $scanOutput 'discovery-host.log') -RedirectStandardError (Join-Path $scanOutput 'discovery-host-error.log') | Out-Null
Write-Output 'Scheduled app host requested.'
