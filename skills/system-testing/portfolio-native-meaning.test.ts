import {expect,it,vi} from 'vitest';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},panelTree:{},rpc:{},vcs:{}}));
vi.mock('./session-replay-managed.js',()=>({createOwnedHeadlessChannel:()=>{throw Error('No live channel in component control')}}));
vi.mock('./scratch-handoff-managed.js',()=>({readWorkspaceBytes:()=>{throw Error('No live read in component control')}}));
vi.mock('./regency-fixture-player.js',()=>({bindRegencyFixturePlayer:()=>{throw Error('No live player in component control')}}));
vi.mock('@workspace-skills/scratch-handoff-bindings',()=>({bindScratchHandoff:(fs:any)=>({scratchHandoffWrite:{stage:async(text:string)=>{await fs.writeFile('/.tmp/evidence-handoff-test/handoff.json',text);return{path:'/.tmp/evidence-handoff-test/handoff.json'}}}})}));
import {prepareOpenPortfolio} from './open-goal-portfolio-managed.js';
import {openPortfolioWorlds} from './open-goal-portfolio-worlds.js';
const scope='11111111-1111-4111-8111-111111111111';
async function fixture(id='recognition-is-not-relocation'){
 let tick=6,month=0,pending:any=null;const files=new Map<string,string>();let head='working';
 const residents=[{id:'pip',name:'Pip',home:'meadow',needs:[],energy:1,attachment:0,lastVisit:-1,settled:0},{id:'sol',name:'Sol',home:'hollow',needs:[],energy:1,attachment:0,lastVisit:-1,settled:0}];
 const g=()=>({day:Math.floor(tick/4),phase:tick%4,weather:'rain',homes:[],residents:structuredClone(residents),discoveries:[]});
 const realm=(m:number)=>({month:m});
 const installed={garden:()=>({read:async()=>({garden:g(),pending:null,seated:false})}),readGarden:(id:string,value:any)=>({id,...value}),reviewGarden:(request:any)=>({decision:'contradicted',finding:'Recognition is not relocation.',evidenceIds:[request.before?.id??request.current.id,request.after?.id??request.current.id]}),realm:{owner:()=>({read:async()=>({game:{world:realm(month),programs:{}},pending,painting:false}),preview:async(months:number)=>({basis:realm(month),forecast:realm(month+months)})}),readback:(id:string,value:any)=>({id,month:value.month,treasury:100,debt:0,income:1,spending:1,serviceCost:0,worksCost:0,routes:[],regions:[{id:'crownlands',grain:14,population:10,confidence:1}],borderTension:0}),review:(request:any)=>({decision:'supported',finding:'Actual projected reserve is14.',evidenceIds:[request.current?.id??request.after.id]})}};
 const fs={mkdtemp:async()=>'/ .tmp/portfolio'.replace(' ',''),writeFile:async(path:string,text:string)=>{files.set(path,text)},readdir:async()=>files.has('/.tmp/evidence-handoff-test/handoff.json')?['portfolio','evidence-handoff-test']:['portfolio']};
 const ports={contextId:'ctx',fs,status:async()=>({mainEventId:'main',workingHead:{id:head}}),open:async()=>({key:'owned'}),gardenPlayer:{pulse:async()=>{tick++},visit:async(_before:any,name:string)=>{const r=residents.find(r=>r.name===name)!;const day=Math.floor(tick/4);if(r.lastVisit!==day){r.attachment=Math.min(1,r.attachment+.1);r.lastVisit=day}}},realmPlayer:{seat:async()=>{},advance:async(id:string,n:number)=>{month+=n;pending={id}},cancel:async()=>{pending=null}},readBytes:async(path:string)=>new TextEncoder().encode(files.get(path)??'')};
 const prepared=await prepareOpenPortfolio({contextId:'ctx',caseId:'demo-portfolio-'+id,portfolioFixture:{gardenId:'natlang-garden-'+scope,gardenPanelId:'g',regency:{realm:'natlang-realm-'+scope,panelId:'r'} as never}},installed as never,ports as never);
 const index=await prepared.services.demoPortfolioIndex.list();const [opening,current]=[await prepared.services.demoPortfolioState.read(index.id),await prepared.services.demoPortfolioState.read(index.id)];
 return{prepared,index,opening:opening!,current:current!,files,foreignHead:()=>{head='foreign'}};
}
async function answer(f:Awaited<ReturnType<typeof fixture>>){
 const projection=await f.prepared.services.demoPortfolioForecast.preview(f.index.id,f.current.id,1);
 return{plan:{criteriaBasis:null,garden:[],realm:[],months:1,note:'none'},opening:f.opening,current:f.current,projection,garden:[{criterion:{kind:'transition',check:{kind:'relocated',resident:'Pip'}},review:{decision:'contradicted',finding:'The home remains meadow; visits and recognition did not relocate Pip.',evidenceIds:[f.opening.garden.id,f.current.garden.id]}}],realm:[],decision:{status:'blocked',write:false,explanation:'Pip was not relocated; native projected Crownlands grain14 exceeds13.'},note:null};
}
it('binds equivalent display-name findings for mandatory review without private ID/result equality or masks',async()=>{
 const f=await fixture();const report=await answer(f);await f.prepared.services.demoPortfolioState.read(f.index.id);await f.prepared.services.demoPortfolioState.read(f.index.id);
 const proof=await f.prepared.verify(report);expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);expect(proof.incorrectReturnValues).toEqual([]);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);expect(proof.frames).toHaveLength(4);expect(proof.garden.actorFindings).toEqual(report.garden);expect(proof).not.toHaveProperty('plan');
});
it('allows concurrent repeated forecasts and retains all actual provenance while rejecting forged projection',async()=>{
 const f=await fixture();const reports=await Promise.all([1,2,1].map(n=>f.prepared.services.demoPortfolioForecast.preview(f.index.id,f.current.id,n as 1|2)));expect(reports.every(Boolean)).toBe(true);
 const report=await answer(f);expect((await f.prepared.verify(report)).passed).toBe(true);const forged=await f.prepared.verify({...report,projection:{...report.projection,accounts:{...report.projection!.accounts,treasury:999}}});expect(forged.checks.actualPortfolioForecast).toBe(false);
});
it('retains true requested-answer and read-only write boundaries',async()=>{
 const f=await fixture();const report=await answer(f);const missing=await f.prepared.verify({...report,decision:{...report.decision,explanation:''}});expect(missing.checks.requestedPortfolioAnswer).toBe(false);
 expect(await f.prepared.services.demoPortfolioHandoff.stage({...report,decision:{...report.decision,write:true}} as never)).toBeNull();
 expect(await f.prepared.services.demoPortfolioForecast.preview('foreign',f.current.id,1)).toBeNull();
});
it('keeps incorrect nonempty semantic claims subject to independent meaning review instead of certifying them',async()=>{
 const f=await fixture();const report=await answer(f);report.decision.explanation='Pip relocated and all forecast values were committed.';const proof=await f.prepared.verify(report);expect(proof.semanticReviewRequired).toBe(true);expect(proof.semanticReviewInput.actual.requestedReturn).toEqual(report);expect(proof.garden.final).toEqual(f.current.garden);
});
it('stages requested native bytes idempotently without a private canonical report and rejects changed retry/head',async()=>{
 const f=await fixture('repeat-visit-and-untallied-ferry');const report={...await answer(f),projection:null,decision:{status:'blocked',write:true,explanation:'Actual private diagnostic in alternative wording.'}};
 const receipt=await f.prepared.services.demoPortfolioHandoff.stage(report as never);expect(receipt).not.toBeNull();expect(await f.prepared.services.demoPortfolioHandoff.stage(report as never)).toEqual(receipt);
 expect(await f.prepared.services.demoPortfolioHandoff.stage({...report,decision:{...report.decision,explanation:'Changed body'}} as never)).toBeNull();
 const proof=await f.prepared.verify(undefined);expect(proof.passed).toBe(true);expect(proof.artifact).toContain(report.decision.explanation);expect(proof.semanticReviewRequired).toBe(true);
 f.foreignHead();expect((await f.prepared.verify({...report,note:receipt})).checks.preservedPortfolioWorkspace).toBe(false);
});
it('retains the literal worlds and explicit returned-answer obligations across the whole family',()=>{expect(openPortfolioWorlds).toHaveLength(26);expect(openPortfolioWorlds.every(row=>typeof row.requestedAnswer==='boolean')).toBe(true);expect(openPortfolioWorlds.filter(row=>row.plan.note==='none').every(row=>row.requestedAnswer)).toBe(true)});

it('keeps private reference qualification strict while separating it from teacher acceptance',async()=>{
 const valid=await fixture();expect((await valid.prepared.qualify()).referenceChecks).toEqual({garden:true,realm:true,status:true});
 const wrongFixture=await fixture('recognition-and-projected-port-capacity');const proof=await wrongFixture.prepared.qualify();expect(proof.referenceChecks.garden).toBe(false);expect(proof.passed).toBe(false);
});

it('preserves conditional write authority and actual retained artifact bytes',async()=>{
 const f=await fixture('one-phase-cannot-pass-dawn');const report={...await answer(f),projection:null,decision:{status:'ready',write:true,explanation:'Invented readiness must not confer stage authority.'}};
 expect(await f.prepared.services.demoPortfolioHandoff.stage(report as never)).toBeNull();
 const audit=await fixture('repeat-visit-and-untallied-ferry');const actual={...await answer(audit),projection:null,decision:{status:'blocked',write:true,explanation:'Actual native diagnostic.'}};
 expect(await audit.prepared.services.demoPortfolioHandoff.stage({...actual,decision:{...actual.decision,explanation:'x'.repeat(25*1024)}} as never)).toBeNull();
 const receipt=await audit.prepared.services.demoPortfolioHandoff.stage(actual as never);expect(receipt).not.toBeNull();audit.files.set(receipt!.path,'tampered');expect((await audit.prepared.verify(undefined)).checks.verifiedPrivatePortfolioHandoff).toBe(false);
});
