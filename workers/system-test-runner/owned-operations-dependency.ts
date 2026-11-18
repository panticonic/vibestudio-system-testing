/** Host-only exact readiness/ordering mechanics; no semantic decisions or invented checkpoints. */
export const ownedContentDependencyCode=String.raw`function createOwnedContentDependency(owned,expected){
 const events=[];let sequence=0,lastRead=null,closed=false;
 const record=(kind,value)=>events.push({sequence:++sequence,kind,...structuredClone(value)});
 const service={...owned.service,
  async read(handle){const value=await owned.service.read(handle);lastRead={handle:structuredClone(handle),value:structuredClone(value)};record("operationOutcomeRead",lastRead);return value;},
  async close(){const value=await owned.service.close();closed=true;record("operationCleanup",{value});return value;},
 };
 function checks(){
  const audit=owned.audit(),snapshot=audit.snapshots.find(row=>row.phase==="before-cleanup"&&row.handle.role==="release");
  const wanted=expected.roles.release,decisions=wanted?.decisions??[wanted?.decision];
  const sameSet=(a,b)=>a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);
  return {readyRequired:expected.decision==="ready",actualRestart:audit.restarts.length===1,
   programCleanup:closed&&audit.programRequestedCleanup,actualAbsence:audit.remainingEntityIds.length===0&&audit.remainingContextIds.length===0,
   actualOutcomeRead:!!lastRead&&!!snapshot&&lastRead.handle.id===snapshot.handle.id&&JSON.stringify(lastRead.value)===JSON.stringify(snapshot.value),
   exactPersistedState:!!snapshot&&snapshot.value.revision===decisions.length&&snapshot.value.checkpoints.length===decisions.length&&snapshot.value.checkpoints.every((row,i)=>row.revision===i+1&&row.assessment.role==="release"&&row.assessment.decision===decisions[i]&&sameSet(row.assessment.evidenceIds,wanted.evidenceIds)),
  };
 }
 const requireReady=()=>{if(!Object.values(checks()).every(Boolean))throw new Error("Read the actual ready post-restart release outcome and finish owned cleanup before preparing the dependent project");};
 function wrapProject(project){return {...project,
  async prepare(head){requireReady();const value=await project.prepare(head);record("projectPrepared",{head:value.head});return value;},
  async writeDocuments(head,documents){requireReady();const value=await project.writeDocuments(head,documents);record("projectWritten",{head:value.head});return value;},
  async commit(head,message){requireReady();const value=await project.commit(head,message);record("projectCommitted",value);return value;},
 };}
 function audit(){const result=checks();const order=events.map(e=>e.kind);result.effectOrder=order.lastIndexOf("operationOutcomeRead")>=0&&order.lastIndexOf("operationCleanup")>order.lastIndexOf("operationOutcomeRead")&&order.indexOf("projectPrepared")>order.lastIndexOf("operationCleanup")&&order.indexOf("projectWritten")>order.indexOf("projectPrepared")&&order.indexOf("projectCommitted")>order.indexOf("projectWritten");return {passed:Object.values(result).every(Boolean),checks:result,events:structuredClone(events)};}
 return {service,wrapProject,audit};
}`;
