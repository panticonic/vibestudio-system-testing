import {expect,it,vi} from 'vitest';
import {currentContextProjectionsPath} from '@vibestudio/workspace/contextProjections';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},rpc:{},vcs:{},workspace:{}}));
vi.mock('./scratch-handoff-managed.js',()=>({readWorkspaceBytes:vi.fn()}));
import {prepareWorkspaceConfig} from './open-goal-workspace-config-managed.js';
it('reads a valid question set in either order and refreshes the actual current settings without a one-shot route',async()=>{
 const owner='config-question-owner',files=new Map<string,string>();let restore='focused';
 const config=()=>({id:'owned-config',systemEpoch:1,panelRestorePolicy:restore,initPanels:[{source:'panels/welcome'}]});
 const ports={contextId:owner,fs:{mkdtemp:async()=> '/.tmp/config-fixture',writeFile:async(path:string,text:string)=>{files.set(path,text);},exists:async(path:string)=>files.has(path),readdir:async()=>['config-fixture']},readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??''),vcs:{status:async()=>({contextId:owner,clean:true,integrating:[],mainEventId:'main',workingHead:{kind:'event',eventId:'head'},committed:{eventId:'main'}}),mainState:async()=>({kind:'event',eventId:'main'})},workspace:{getActive:async()=>'Owned workspace',getConfig:async()=>config(),getInfo:async()=>({id:'workspace',name:'Owned workspace',config:config(),appVersion:'1',currentAppVersion:'1',statePath:'/owned/config',contextProjectionsPath:currentContextProjectionsPath('/owned/config')})}};
 const fixture=await prepareWorkspaceConfig({contextId:owner,caseId:'workspace-config-missing-settings-card'},ports as unknown as NonNullable<Parameters<typeof prepareWorkspaceConfig>[1]>);
 const native=fixture.services.nativeWorkspaceConfig;await native.readBrief();
 const partial=await native.inspectActive(['launch-panels']);expect(partial?.facts.map(f=>f.question)).toEqual(['launch-panels']);
 const first=await native.inspectActive(['panel-restore','launch-panels']);expect(new Set(first?.facts.map(f=>f.question))).toEqual(new Set(['launch-panels','panel-restore']));
 restore='none';const second=await native.inspectActive(['launch-panels','panel-restore']);expect(second?.facts.find(f=>f.question==='panel-restore')?.value).toBe('"none"');
 expect(await native.inspectActive(['launch-panels','launch-panels'])).toBeNull();expect(await native.inspectActive(['not-a-field' as never])).toBeNull();
 const outcome={noteStatus:'no-note',sourceStatus:'uninspected',dependencyStatus:'uninspected',affectedQuestions:[],workingDifferences:[],committedDifferences:[],summary:'No saved card exists; the current launch panel is Welcome and restore is now none.'};
 const proof=await fixture.verify({outcome,handoff:null});expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.evidence?.active).toEqual(second);expect((await fixture.verify(undefined)).passed).toBe(false);
});
