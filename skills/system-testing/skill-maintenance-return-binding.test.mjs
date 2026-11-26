import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {URL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import test,{after} from 'node:test';
const esbuild=createRequire(import.meta.url)('esbuild');
after(()=>esbuild.stop());
const target=fileURLToPath(new URL('./open-goal-skill-maintenance-managed.ts',import.meta.url));
const source=readFileSync(target,'utf8');
// Execute the actual production closure body with controlled dependency boundaries.
// The Native validator always FAILS here: this proves binding/error behavior, never application qualification.
function actualVerify(text){
 const begin=text.indexOf('  async function verify(report:');
 const end=text.indexOf('async function verifyNativeApplication(',begin);
 assert.ok(begin>=0&&end>begin,'actual production verifier closure boundary');
 const body=text.slice(begin,end);
 const compiled=esbuild.transformSync(body,{loader:'ts',target:'es2022'}).code;
 const calls=[];const checks={returnedMaintenanceValue:false,nativeContract:false};
 const native={passed:false,checks,outcomeContract:{effects:{checks:['nativeContract'],rationale:'Deliberately failing TEST-only Native dependency'},returnedValue:{checks:['returnedMaintenanceValue'],required:true,rationale:'TEST-only requested answer'}}};
 const verifyNativeApplication=async()=>structuredClone(native);
 const assessObservedApplicationOutcome=async(...args)=>{calls.push(args);return{...args[0],observedChecks:args[0].checks};};
 const verify=new Function('verifyNativeApplication','assessObservedApplicationOutcome',compiled+'\nreturn verify;')(verifyNativeApplication,assessObservedApplicationOutcome);
 return {verify,calls,native};
}
test('the captured original selector actually throws for the unbound name, independent of native verdict',async()=>{
 const original=execFileSync('git',['-C',fileURLToPath(new URL('../..',import.meta.url)),'show','6f75db0210195cb690b4e6b19c60354331e929b2:skills/system-testing/open-goal-skill-maintenance-managed.ts'],{encoding:'utf8'});
 await assert.rejects(actualVerify(original).verify({action:'hold-evidence',reason:'TEST-only'}),error=>error instanceof ReferenceError&&/value is not defined/.test(error.message));
});
test('the actual report selects its semantic decision contribution without changing a failed native verdict',async()=>{
 const fixture=actualVerify(source),report={action:'hold-evidence',reason:'The retained witness belongs to the archive.'};
 const result=await fixture.verify(report);assert.equal(result.passed,false);assert.deepEqual(result.checks,fixture.native.checks);assert.equal(fixture.calls[0][2],report);assert.equal(fixture.calls[0][4][0].producerSourceSuffix,'maintainWorkspaceSkill/decideSkillMaintenance.nl');
});
test('an actual patch receipt selects the real repair contribution and remains a failed native observation',async()=>{
 const fixture=actualVerify(source),report={disposition:'staged',before:'old',after:'new',paths:['run/check.nl']};
 const result=await fixture.verify(report);assert.equal(result.passed,false);assert.deepEqual(result.checks,fixture.native.checks);assert.equal(fixture.calls[0][2],report);assert.equal(fixture.calls[0][4][0].producerSourceSuffix,'maintainWorkspaceSkill/prepareSkillRepair.nl');
});
test('absent returns do not trigger an unrelated unbound-variable exception or become native successes',async()=>{
 for(const report of [null,undefined]){const fixture=actualVerify(source);const result=await fixture.verify(report);assert.equal(result.passed,false);assert.deepEqual(result.checks,fixture.native.checks);assert.equal(fixture.calls[0][2],report);}
});
