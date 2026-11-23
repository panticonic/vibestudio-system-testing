import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeStartupDiagnostic,nativeStartupDiagnosticCode,NATIVE_STARTUP_DIAGNOSTIC_CASE} from './native-startup-diagnostic.ts';
const world={id:NATIVE_STARTUP_DIAGNOSTIC_CASE,goal:'Original owner goal'};
const input={caseId:world.id,goal:world.goal,qualification:true,startupDiagnostic:{epoch:'native_epoch_123'}};
test('ordinary teacher and qualification requests remain ordinary',()=>assert.equal(validateNativeStartupDiagnostic({...input,startupDiagnostic:undefined},world),undefined));
test('diagnostic admits only one bounded epoch on the original qualified world',()=>{
 assert.deepEqual(validateNativeStartupDiagnostic(input,world),input.startupDiagnostic);
 for(const change of [{qualification:false},{qualification:1},{caseId:'another-world'},{goal:'rewritten goal'},{startupDiagnostic:{}},{startupDiagnostic:{epoch:'a'}},{startupDiagnostic:{epoch:'native_epoch_123',model:'teacher'}},{startupDiagnostic:{epoch:'bad;code()'}}])assert.throws(()=>validateNativeStartupDiagnostic({...input,...change},world),/exact scheduled world/);
 assert.throws(()=>validateNativeStartupDiagnostic(input),/exact scheduled world/);
});
test('child acknowledges exact finite owner without oracle or teacher success',()=>{
 const code=nativeStartupDiagnosticCode({epoch:'native_epoch_123',contextId:'owned',caseId:world.id,runId:'system-test-runner:teacher:123',evalScope:'finite-owner-123'});
 const body=code.replace(/import[^;]+;/,'');
 const result=new Function('actualContextId',body+'return utilityValue;')('owned');
 assert.equal(result.teacher,null);assert.equal(result.verification,null);assert.deepEqual(result.verificationErrors,[]);
 assert.equal(result.startupDiagnostic.epoch,'native_epoch_123');assert.equal(result.startupDiagnostic.runId,'system-test-runner:teacher:123');assert.equal(result.startupDiagnostic.evalScope,'finite-owner-123');assert.equal(result.startupDiagnostic.modelCallsRequested,0);assert.equal(result.diagnosticOnly,true);
 assert.throws(()=>new Function('actualContextId',body+'return utilityValue;')('other-context'),/another context/);
});
