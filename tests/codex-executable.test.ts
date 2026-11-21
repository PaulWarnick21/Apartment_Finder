import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexExecutable} from '../server/codex-executable.ts';
const old='C:/Program Files/WindowsApps/OpenAI.Codex_1.0_x64__publisher/app/resources/codex.exe';
const current='C:/Program Files/WindowsApps/OpenAI.Codex_2.0_x64__publisher/app/resources/codex.exe';
test('obsolete Store executable resolves the current registered package without changing account policy',async()=>{
 assert.equal(await codexExecutable(old,{platform:'win32',exists:p=>p===current,installed:async()=>current}),current);
});
test('explicit existing executable is respected; missing custom overrides fail clearly',async()=>{
 assert.equal(await codexExecutable('D:/tools/codex.exe',{exists:()=>true,installed:async()=>{throw Error('No discovery needed');}}),'D:/tools/codex.exe');
 await assert.rejects(codexExecutable('D:/missing/codex.exe',{exists:()=>false}),/Configured Codex executable is missing/);
});
test('unconfigured Windows monitor discovers the registered package and other platforms use PATH',async()=>{
 assert.equal(await codexExecutable('',{platform:'win32',exists:p=>p===current,installed:async()=>current}),current);
 assert.equal(await codexExecutable('',{platform:'linux'}),'codex');
 assert.equal(await codexExecutable(old,{platform:'win32',exists:()=>false,installed:async()=>undefined}),'codex');
});
