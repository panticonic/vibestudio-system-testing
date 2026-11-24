import{expect,it}from 'vitest';
import{coordinatedEditScope}from './coordinated-edit-scope.js';
const basis=[{path:'guide.md',text:'# Guide\nUse south entrance.\nKeep courtyard access.\n'},{path:'card.md',text:'Open south entrance at 07:15.\nDesk note stays.\n'}];
const reference=[{path:'guide.md',version:'guide-current',text:'# Guide\nUse north entrance.\nKeep courtyard access.\n'},{path:'card.md',version:'card-current',text:'Open north entrance at 07:15.\nDesk note stays.\n'}];
it('accepts equivalent changed prose with an exact complete atomic file/version basis',()=>{
 const drafts=[{...reference[0]!,text:'# Guide\nEnter through the north entrance.\nKeep courtyard access.\n'},{...reference[1]!,text:'07:15 — open the north entrance.\nDesk note stays.\n'}];
 expect(coordinatedEditScope(drafts,reference,basis)).toBe(true);
 expect(coordinatedEditScope(drafts.slice(0,1),reference,basis)).toBe(false);
 expect(coordinatedEditScope([{...drafts[0]!,version:'stale'},drafts[1]!],reference,basis)).toBe(false);
 expect(coordinatedEditScope([drafts[0]!,{...drafts[1]!,text:'07:15 — open the north entrance.\nDeleted desk note.\n'}],reference,basis)).toBe(false);
 expect(coordinatedEditScope([drafts[0]!,drafts[0]!],reference,basis)).toBe(false);
});
