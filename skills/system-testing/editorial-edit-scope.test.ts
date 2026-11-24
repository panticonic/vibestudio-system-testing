import {expect,it}from 'vitest';
import {editorialEditScope}from './editorial-edit-scope.js';
import {openEditorialWorlds}from './open-goal-editorial-worlds.js';
const line=(label:string,value:string)=>`- ${label}: ${value}\n`;
it.each(openEditorialWorlds)('preserves protected copy and explicit literal requirements for $id',world=>{
 const before='# Candidate\n'+world.fields.map(field=>field.before===null?'':line(field.label,field.before)).join('')+'\nKeep accessibility text.\n';
 const exact='# Candidate\n'+world.fields.map(field=>field.after===null?'':line(field.label,field.after)).join('')+'\nKeep accessibility text.\n';
 expect(editorialEditScope(before,exact,world.fields,world.literalApprovedWording)).toBe(true);
 expect(editorialEditScope(before,exact.replace('Keep accessibility text.','Changed protected paragraph.'),world.fields,world.literalApprovedWording)).toBe(false);
 const alternative='# Candidate\n'+world.fields.map(field=>field.after===null?'':line(field.label,field.after+' (approved original)')).join('')+'\nKeep accessibility text.\n';
 expect(editorialEditScope(before,alternative,world.fields,world.literalApprovedWording)).toBe(!world.literalApprovedWording||world.fields.every(field=>field.after===null));
 const added=world.fields.find(field=>field.after!==null);
 if(added)expect(editorialEditScope(before,exact+line(added.label,added.after!),world.fields,world.literalApprovedWording)).toBe(false);
});
