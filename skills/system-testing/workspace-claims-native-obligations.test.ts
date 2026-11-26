import {it,expect,vi} from 'vitest';
vi.mock('@workspace/runtime',()=>({contextId:null,fs:{},rpc:{},vcs:{}}));
vi.mock('./scratch-handoff-managed.js',()=>({readWorkspaceBytes:vi.fn()}));
// Controlled guide text is a Native port input; installed knowledge loading is covered by the real joint-loader controls.
const guide='A green build does not establish another candidate, a rendered surface or publication authority.';
import {nativeSemanticFixturePorts} from './nativeSemanticFixturePorts.js';
import {prepareWorkspaceClaims} from './open-goal-workspace-claims-managed.js';
import {openWorkspaceClaimWorlds} from './open-goal-workspace-claims-worlds.js';
function ports(){return{...nativeSemanticFixturePorts(),runtime:'source-reference',guide:async()=>guide,preflight:async()=>({operationId:'exact-status-read',decision:'allowed',leaves:[]})};}
for(const world of openWorkspaceClaimWorlds)it('independently checks current claims, native tests and protected state: '+world.id,async()=>{const fixture=await prepareWorkspaceClaims({contextId:'owner',caseId:world.id},ports() as never);const proof=await fixture.qualify();expect(proof.passed).toBe(true);expect(proof.semanticReviewRequired).toBe(true);if(world.note)expect(proof.artifact).not.toBeNull();});
it('accepts reordered actual supported claims and rejects duplicate or reassigned claims',async()=>{const fixture=await prepareWorkspaceClaims({contextId:'owner',caseId:'workspace-claims-gate-rail-exact-readback'},ports() as never);const prior=await fixture.qualify();const value={support:{supported:[...prior.support.supported].reverse(),missing:[...prior.support.missing].reverse()},disposition:prior.disposition,handoff:prior.handoff};expect((await fixture.verify(value)).passed).toBe(true);expect((await fixture.verify({...value,support:{supported:[],missing:[...value.support.supported,...value.support.missing]}})).passed).toBe(false);expect((await fixture.verify({...value,support:{...value.support,supported:value.support.supported.map(()=>value.support.supported[0])}})).passed).toBe(false);});
