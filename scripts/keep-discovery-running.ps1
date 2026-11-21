$ErrorActionPreference = 'Stop'
$scanRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $scanRoot
$scanPowerFile = Join-Path $scanRoot 'data/live/discovery-power.json'
$scanMutex = [Threading.Mutex]::new($false, 'Local\ApartmentFinderScheduledHost')
if (-not $scanMutex.WaitOne(0)) { $scanMutex.Dispose(); exit 0 }
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class DiscoverySchedulePower {
 [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
}
"@
$scanZone = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
$scanChrome = @("$env:ProgramFiles/Google/Chrome/Application/chrome.exe", "${env:ProgramFiles(x86)}/Google/Chrome/Application/chrome.exe", "$env:LOCALAPPDATA/Google/Chrome/Application/chrome.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
try {
 while (Test-Path -LiteralPath $scanPowerFile) {
  $scanPower = Get-Content -LiteralPath $scanPowerFile -Raw | ConvertFrom-Json
  if (-not $scanPower.enabled) { break }
  $scanLocal = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $scanZone)
  $scanWindow = $scanLocal.Hour -ge 21 -or $scanLocal.Hour -lt 3 -or ([int]$scanLocal.DayOfWeek -in 1,2,3,4 -and $scanLocal.Hour -ge 5 -and $scanLocal.Hour -lt 13)
  [DiscoverySchedulePower]::SetThreadExecutionState([uint32]$(if ($scanWindow) {2147483649} else {2147483648})) | Out-Null
  try {
   $scanHealth = Invoke-RestMethod 'http://127.0.0.1:4317/api/health' -TimeoutSec 5
   if ($scanHealth.app -ne 'apartment-finder' -or $scanHealth.demo) { throw 'Unexpected local service' }
  } catch {
   & (Join-Path $PSScriptRoot 'open-app.ps1') -NoBrowser
  }
  if ($scanWindow -and $scanChrome -and -not (Get-Process chrome -ErrorAction SilentlyContinue)) {
   Start-Process -FilePath $scanChrome -ArgumentList 'about:blank' -WindowStyle Hidden
  }
  Start-Sleep -Seconds 30
 }
} finally {
 [DiscoverySchedulePower]::SetThreadExecutionState([uint32]2147483648) | Out-Null
 $scanMutex.ReleaseMutex(); $scanMutex.Dispose()
}
