import {describe,it,expect,vi} from 'vitest';
vi.mock('@workspace/runtime',()=>({rpc:{},vcs:{},workers:{},workspace:{},extensions:{},contextId:'TEST-catalog-only',panels:{}}));
import {managedWebBriefTests} from './tests/web-brief-managed.js';

describe('canonical native reference catalog declaration',()=>{
 it('declares all2327 oracle variants and keeps every paid paired case ordinary',()=>{
  const references=managedWebBriefTests.filter(test=>test.name.startsWith('open-goal-oracle-'));
  expect(references).toHaveLength(2327);
  expect(references.every(test=>test.nativeReference===true&&typeof test.orchestrate==='function')).toBe(true);
  for(const reference of references){
   const paid=managedWebBriefTests.find(test=>test.name===reference.name.replace('open-goal-oracle-','open-goal-'));
   expect(paid).toBeDefined();expect(paid?.nativeReference).toBeUndefined();
   expect(paid?.prompt).toBe(reference.prompt);
   expect(paid?.requiresUnits).toEqual(reference.requiresUnits);
   expect(paid?.resources).toEqual(reference.resources);
   expect(paid?.sharedResources).toEqual(reference.sharedResources);
  }
 });
});
