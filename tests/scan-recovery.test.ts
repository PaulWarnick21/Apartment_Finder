import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRecovery,recoveryReady} from '../server/scan-recovery.ts';
test('transient and parser failures back off without permanently suppressing a source',()=>{
 const first=sourceRecovery('Navigation timeout',undefined,1000)!;
 assert.equal(first.retryAt,301000);assert.equal(recoveryReady(first,undefined,2000),false);
 assert.equal(recoveryReady(first,undefined,301000),true);
 const second=sourceRecovery('No listing cards recognized',first,301000)!;
 assert.equal(second.retryAt,1201000);
 const third=sourceRecovery('Local app disconnected',second,1201000)!;
 assert.equal(third.retryAt,4801000);
 assert.equal(sourceRecovery('Fresh discovery checked; 5 candidates processed.',third),undefined);
});
test('recovery cannot override an access warning or server cooldown',()=>{
 assert.equal(recoveryReady(undefined,{needs_attention:1,paused_until:'2000-01-01T00:00:00Z'}),false);
 assert.equal(recoveryReady(undefined,{paused_until:'2099-01-01T00:00:00Z'}),false);
 assert.equal(recoveryReady(undefined,{needs_attention:0,paused_until:'2000-01-01T00:00:00Z'}),true);
});
