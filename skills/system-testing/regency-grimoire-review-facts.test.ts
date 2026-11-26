import {expect,it} from 'vitest';
import {sha256HexSyncText} from '@vibestudio/content-addressing';
import {observedGrimoireAuthority,observedRegencyEvidence} from './native-domain-review.js';
it('distinguishes a fresh viewed frontier from a still-stale caretaker authorization without inferring a goal verdict',()=>{
 const scope={ownerId:'owned',frontier:'older',approved:true},view={ownerId:'owned',frontier:'newer'};
 const facts=observedGrimoireAuthority(scope,view,view,{frontier:'newer',status:'current'});
 expect(facts).toEqual({scopeOwnerMatchesCurrent:true,scopeFrontierMatchesCurrent:false,viewedFrontierMatchesCurrent:true,approved:true,gateConfirmsViewedFrontier:true});
 expect(observedGrimoireAuthority({...scope,ownerId:'foreign'},view,view,undefined).scopeOwnerMatchesCurrent).toBe(false);
 expect(observedGrimoireAuthority({...scope,frontier:'newer'},view,view,undefined).scopeFrontierMatchesCurrent).toBe(true);
 expect(observedGrimoireAuthority(scope,null,view,undefined).viewedFrontierMatchesCurrent).toBe(false);
 expect(facts).not.toHaveProperty('accepted');
});
it('exposes an actually pending council independently of forecast wealth or a missing artifact',()=>{
 const facts=observedRegencyEvidence({revision:'current',pending:'actual-settlement',accounts:{month:3}},null,null);
 expect(facts.currentCouncil.pendingSettlementAbsent).toBe(false);expect(facts.currentCouncil.pendingSettlement).toBe('actual-settlement');expect(facts.retainedPrivateNote.bytesPresent).toBe(false);expect(facts.retainedPrivateNote.byteLength).toBe(0);
 expect(observedRegencyEvidence({revision:'current',pending:null,accounts:{month:3}},null,null).currentCouncil.pendingSettlementAbsent).toBe(true);
});
it('binds real retained note bytes without imposing a JSON layout, and exposes missing, stale or corrupt receipts',()=>{
 const committed={revision:'committed',pending:null,accounts:{month:3,treasury:76.1}};const advance={committed};const text=JSON.stringify({scope:'private-local',advance,decision:{explanation:'Leave the requested private note.'}});const receipt={path:'/.tmp/owned-note/handoff.json',revision:'committed',digest:sha256HexSyncText(text)};
 const facts=observedRegencyEvidence(committed,receipt,text);expect(facts.retainedPrivateNote).toMatchObject({bytesPresent:true,receiptMatchesBytes:true,receiptMatchesCurrentRevision:true});
 expect(observedRegencyEvidence(committed,receipt,null).retainedPrivateNote.receiptMatchesBytes).toBe(false);
 expect(observedRegencyEvidence(committed,{...receipt,digest:'forged'},text).retainedPrivateNote.receiptMatchesBytes).toBe(false);
 expect(observedRegencyEvidence({...committed,revision:'later'},receipt,text).retainedPrivateNote.receiptMatchesCurrentRevision).toBe(false);
 const prose="Actual committed month3 treasury is76.1 crowns.";const proseReceipt={...receipt,digest:sha256HexSyncText(prose)};expect(observedRegencyEvidence(committed,proseReceipt,prose).retainedPrivateNote.receiptMatchesBytes).toBe(true);
 expect(facts.retainedPrivateNote).not.toHaveProperty('includesActualCommittedLedger');
});
