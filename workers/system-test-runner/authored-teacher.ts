/** Exact source-authentic capture shared by harness-owned workflow roots, including failures. */
export function authoredTeacherCode(options: { programPath: string; rootName: string; serviceNames: string[]; executorModel: string; request: unknown; bindingCode: string }, runId: string): string {
  return `
${options.bindingCode}
      natlang.captureModelTurns({executorModel:${JSON.stringify(options.executorModel)}});
      const programPath=${JSON.stringify(options.programPath)};
      let report=null, executionError=null;
      try {
        const root=await natlang.load(programPath,{services:Object.fromEntries(${JSON.stringify(options.serviceNames)}.map(name=>[name,assignedService]))});
        report=await root(${JSON.stringify(options.request)});
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
      if(!rootRecord || rootRecord.definition.name!==${JSON.stringify(options.rootName)}) captureErrors.push("Assigned authored root was not observed");
      if(rootRecord?.outcome!=="done") captureErrors.push("Assigned authored root did not complete successfully");
      let utilityValue={report,executionError,captureErrors,rootCallIds,calls,evalRunId:${JSON.stringify(runId)},programPath,
        trainingEligible:executionError===null&&captureErrors.length===0};
  `;
}
