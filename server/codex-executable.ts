import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

type Discovery={platform?:string;exists?:(path:string)=>boolean;installed?:()=>Promise<string|undefined>};
function installedWindowsCodex():Promise<string|undefined>{
 return new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation"],{windowsHide:true,timeout:10000,maxBuffer:16000,encoding:'utf8'},(error,stdout)=>{
  const location=stdout.trim();resolve(!error&&location?join(location,'app','resources','codex.exe'):undefined);
 }));
}
/** Store-package paths contain a version and disappear after app updates. Resolve
 * the current registered installation afresh whenever the monitor reconnects. */
export async function codexExecutable(configured=process.env.AF_CODEX_EXECUTABLE,deps:Discovery={}){
 const exists=deps.exists??existsSync,platform=deps.platform??process.platform;
 if(configured&&(!/[\\/]/.test(configured)||exists(configured)))return configured;
 // Only recover obsolete paths belonging to the official versioned app package.
 // A misspelled custom override remains an actionable configuration error.
 if(configured&&!/[\\/]WindowsApps[\\/]OpenAI\.Codex_[^\\/]+[\\/]app[\\/]resources[\\/]codex\.exe$/i.test(configured))throw new Error('Configured Codex executable is missing; update AF_CODEX_EXECUTABLE before full assessment.');
 if(platform==='win32'){
  const installed=await(deps.installed??installedWindowsCodex)();
  if(installed&&exists(installed))return installed;
 }
 return 'codex';
}
