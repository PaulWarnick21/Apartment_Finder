import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
if(existsSync('.git')){
 let existing='';try{existing=execFileSync('git',['config','--get','core.hooksPath'],{encoding:'utf8'}).trim();}catch(error){if(error.status!==1)throw error;}
 if(existing&&existing!=='.githooks')throw new Error('Existing Git hooks path detected; integrate the shortlist hooks before committing.');
 execFileSync('git',['config','--local','core.hooksPath','.githooks']);
 console.log('Installed shortlist pre-commit and pre-push hooks.');
}
