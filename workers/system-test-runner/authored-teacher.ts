export type VibestudioSkill = "repairPanel" | "repairUnit" | "deliverProject" | "integrateWorkspace" | "operate" | "routeMessage";

/** Exact source-authentic capture of the shared program and the skill it actually calls. */
export function authoredTeacherCode<Request extends { goal: string }>(options: { skill: VibestudioSkill; serviceNames: string[]; executorModel: string; request: Request; bindingCode: string }, runId: string): string {
  return captureWorkflow({
    executorModel: options.executorModel,
    workflowRequest: {goal: options.request.goal, work: [{kind: options.skill, input: options.request}]},
    bindingCode: `${options.bindingCode}
      const assignedServices=Object.fromEntries(${JSON.stringify(options.serviceNames)}.map(name=>[name,assignedService]));
    `,
  }, runId, true);
}

type ComposedTeacherOptions = {
  executorModel: string;
  workflowRequest: { goal: string; work: {kind: VibestudioSkill; input: {goal: string}}[] };
  bindingCode: string;
  requiredOrder?: VibestudioSkill[];
};

/** Keep the complete report for goals that require several skills. */
export function composedTeacherCode<Options extends ComposedTeacherOptions>(options: Options, runId: string): string {
  return captureWorkflow(options, runId, false);
}

function captureWorkflow(options: ComposedTeacherOptions, runId: string, single: boolean): string {
  const expected = options.workflowRequest.work.map(item => item.kind).sort();
  if (!expected.length || new Set(expected).size !== expected.length ||
      (options.requiredOrder && JSON.stringify([...options.requiredOrder].sort()) !== JSON.stringify(expected)))
    throw new Error("Declare one assignment per required skill and order only those skills");
  return `
${options.bindingCode}
      natlang.captureModelTurns({executorModel:${JSON.stringify(options.executorModel)}});
      const programPath="skills/vibestudio-workflows/runWorkflow.nl";
      const expectedSkills=${JSON.stringify(expected)}, requiredOrder=${JSON.stringify(options.requiredOrder ?? null)};
      let report=null, executionError=null;
      try {
        const root=await natlang.load(programPath,{services:assignedServices});
        const workflow=await root(${JSON.stringify(options.workflowRequest)});
        const returnedSkills=workflow.results.map(result=>result.kind);
        if(JSON.stringify([...returnedSkills].sort())!==JSON.stringify(expectedSkills) || workflow.remaining.length!==0 ||
           (requiredOrder && JSON.stringify(returnedSkills)!==JSON.stringify(requiredOrder)))
          throw new Error("The shared workflow did not return the assigned skills' completed results");
        report=${single ? "workflow.results[0].report" : "workflow"};
      } catch(error) {
        executionError={name:error instanceof Error?error.name:"ThrownValue",message:error instanceof Error?error.message:String(error)};
      }
      const captureErrors=[], seenCursors=new Set(), seenRows=new Set(), rows=[];
      async function page(after) {
        const batch=await natlang.calls({run:${JSON.stringify(runId)},...(after?{after}:{})});
        if(!batch.length) return;
        for(const row of batch) {if(seenRows.has(row.callId)) captureErrors.push("Duplicate teacher record "+row.callId); else {seenRows.add(row.callId);rows.push(row);}}
        const next=batch[batch.length-1].callId;
        if(next===after || seenCursors.has(next)) {captureErrors.push("Teacher record cursor did not advance");return;}
        seenCursors.add(next);
        await page(next);
      }
      try {await page();} catch(error) {captureErrors.push("Cannot list available records: "+String(error));}
      const ids=new Set(rows.map(row=>row.callId));
      const rootCallIds=rows.filter(row=>row.parentCallId===null).map(row=>row.callId);
      if(rootCallIds.length!==1) captureErrors.push("Teacher run did not record exactly one actual authored root");
      const calls=[];
      for(const row of rows) {
        try {
          const detail=await natlang.trace(row.callId,{raw:true});
          calls.push(detail);
          if(!detail.record || detail.summary.run_id!==${JSON.stringify(runId)} || detail.record.call_id!==row.callId || detail.record.parent_call_id!==row.parentCallId ||
            (detail.record.parent_call_id!==null&&!ids.has(detail.record.parent_call_id))) captureErrors.push("Incomplete run lineage for "+row.callId);
          if(calls.length>1 && (detail.summary.owner_key!==calls[0].summary.owner_key || detail.summary.owner_kind!==calls[0].summary.owner_kind)) captureErrors.push("Teacher records cross owners");
          for(const turn of detail.record?.model_turns??[]) if(turn.kind==="generation"&&turn.reply&&turn.reply.raw_response?.vibestudio?.model!==${JSON.stringify(options.executorModel)}) captureErrors.push("Teacher reply came from another actual model");
        } catch(error) {captureErrors.push("Cannot read record "+row.callId+": "+String(error));}
      }
      const rootRecord=calls.find(call=>call.callId===rootCallIds[0])?.record;
      if(!rootRecord || rootRecord.definition.name!=="runWorkflow") captureErrors.push("Shared Vibestudio workflow root was not observed");
      if(rootRecord?.outcome!=="done") captureErrors.push("Assigned authored root did not complete successfully");
      const children=calls.filter(call=>call.record?.parent_call_id===rootCallIds[0]).map(call=>call.record);
      if(JSON.stringify(children.map(record=>record.definition.name).sort())!==JSON.stringify(expectedSkills) || children.some(record=>record.outcome!=="done"))
        captureErrors.push("The shared workflow did not record the completed assigned skills as direct children");
      if(requiredOrder) {
        const ordered=requiredOrder.map(name=>children.find(record=>record.definition.name===name));
        if(ordered.some((record,index)=>!record || !Number.isFinite(Date.parse(record.started_at)) ||
          !Number.isFinite(Date.parse(record.ended_at)) ||
          (index>0 && !(Date.parse(ordered[index-1]?.ended_at)<=Date.parse(record.started_at)))))
          captureErrors.push("A dependent skill began before its prerequisite completed");
      }
      let utilityValue={report,executionError,captureErrors,rootCallIds,calls,evalRunId:${JSON.stringify(runId)},programPath,
        trainingEligible:executionError===null&&captureErrors.length===0};
  `;
}
