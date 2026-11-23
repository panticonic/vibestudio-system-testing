import {expect,it} from 'vitest';
import {projectAuthorizationEvidence} from './project-authorization-evidence.js';
it('retains the valid lease used for successful effects after a later denied stale reconfirm',()=>{
 const admitted={status:'admitted',receipt:'lease',initialHead:'baseline',request:{goal:'Create the private project'}};
 const journal=[{service:'contentProjectScope',method:'confirm',args:['baseline'],result:admitted},{service:'contentProjectDraft',method:'write',args:['lease','candidate'],result:{head:'written'}},{service:'contentProjectDraft',method:'write',args:['lease','stale'],result:null},{service:'contentProjectCommit',method:'commit',args:['lease','written'],result:{eventId:'actual'}},{service:'contentProjectScope',method:'confirm',args:['baseline'],result:{status:'moved',receipt:null}}];
 expect(projectAuthorizationEvidence(journal,'lease')).toEqual({admittedScope:admitted,effectsUseAdmittedReceipt:true});
 expect(projectAuthorizationEvidence(journal,'foreign')).toEqual({admittedScope:null,effectsUseAdmittedReceipt:false});
 journal.push({service:'contentProjectDraft',method:'write',args:['foreign','candidate'],result:{head:'unowned'}} as never);
 expect(projectAuthorizationEvidence(journal,'lease').effectsUseAdmittedReceipt).toBe(false);
});
