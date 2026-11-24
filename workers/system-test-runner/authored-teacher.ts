import type { SemanticOutcomeContract } from "@workspace/application-outcomes/semantic-outcome-contract";

export type VibestudioSkill =
  | "repairPanel"
  | "repairUnit"
  | "deliverProject"
  | "integrateWorkspace"
  | "operate"
  | "routeMessage";

/** Exact source-authentic capture of the shared program and the skill it actually calls. */
export function authoredTeacherCode<Request extends { goal: string }>(
  options: {
    skill: VibestudioSkill;
    serviceNames: string[];
    executorModel: string;
    request: Request;
    bindingCode: string;
  },
  runId: string,
): string {
  return captureWorkflow(
    {
      executorModel: options.executorModel,
      workflowRequest: {
        goal: options.request.goal,
        work: [{ kind: options.skill, input: options.request }],
      },
      bindingCode: `${options.bindingCode}
      const assignedServices=Object.fromEntries(${JSON.stringify(options.serviceNames)}.map(name=>[name,assignedService]));
    `,
    },
    runId,
    true,
  );
}

type DomainAssignment = {
  kind: "domain";
  domain: string;
  operation: string;
  input: { goal: string };
};
type Assignment =
  | DomainAssignment
  | { kind: VibestudioSkill; input: { goal: string } };

type DomainSelector = Pick<DomainAssignment, "domain" | "operation">;

function requireMountedDomains(assignments: readonly DomainSelector[]): string {
  return `
    for (const {domain,operation} of ${JSON.stringify(assignments)}) {
      if(typeof root.domains?.[domain]?.[operation]!=="function")
        throw new Error("The shared workflow has no mounted callable "+domain+"/"+operation);
    }
  `;
}

export function domainTeacherQualificationCode(
  work: readonly DomainSelector[],
  bindingCode: string,
): string {
  return `
    ${bindingCode}
    const root=await natlang.load("skills/vibestudio-workflows/runWorkflow.nl",{services:assignedServices});
    ${requireMountedDomains(work)}
    const utilityValue=await prepared.qualify();
  `;
}

export function domainTeacherCode<Work extends DomainAssignment>(
  options: {
    executorModel: string;
    work: Work;
    bindingCode: string;
    inputCode: string;
    goalCode?: string;
  },
  runId: string,
): string {
  return captureWorkflow(
    {
      executorModel: options.executorModel,
      workflowRequest: { goal: options.work.input.goal, work: [options.work] },
      bindingCode: options.bindingCode,
    },
    runId,
    true,
    `{goal:${options.goalCode ?? options.inputCode + ".goal"},work:[{
    kind:"domain",domain:${JSON.stringify(options.work.domain)},operation:${JSON.stringify(options.work.operation)},input:${options.inputCode}
  }]}`,
  );
}

type ComposedTeacherOptions = {
  executorModel: string;
  workflowRequest: { goal: string; work: Assignment[] };
  bindingCode: string;
  requiredOrder?: string[];
  heldAssignments?: Record<string, string>;
  requestCode?: string;
  openGoal?: true;
  entry?: SemanticTaskEntry;
};

export type SemanticTaskEntry = {
  program: string;
  callable: string;
  arguments: Record<string, unknown>;
  argumentJson?: Record<string, string>;
  parameterNames: string[];
  inputValues: unknown[];
  resultType: string;
  skill?: string | null;
};

function validateEntry(entry: SemanticTaskEntry): void {
  if (!/^skills\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.(?:nl|ts)$/u.test(entry.program) ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(entry.callable) ||
      !entry.resultType.trim() || new Set(entry.parameterNames).size !== entry.parameterNames.length ||
      Object.keys(entry.arguments).length !== entry.parameterNames.length ||
      entry.parameterNames.some(name => !Object.hasOwn(entry.arguments, name) || typeof JSON.stringify(entry.arguments[name]) !== "string") ||
      (entry.argumentJson !== undefined && (Object.keys(entry.argumentJson).length !== entry.parameterNames.length ||
        entry.parameterNames.some(name => entry.argumentJson?.[name] !== JSON.stringify(entry.arguments[name])))) ||
      JSON.stringify(entry.inputValues) !== JSON.stringify(entry.parameterNames.map(name => entry.arguments[name])))
    throw new Error("A semantic task needs its installed entry and exact application arguments");
}

export function openGoalTeacherCode(options: {executorModel: string; bindingCode: string; goal: string; entry: SemanticTaskEntry; outcomeContract?: SemanticOutcomeContract}, runId: string) {
  if (typeof options.goal !== "string" || !options.goal.trim()) {
    throw new Error("An open-goal teacher needs the catalog's user goal");
  }
  validateEntry(options.entry);
  return captureWorkflow({
    ...options, openGoal: true, workflowRequest: { goal: "", work: [] },
  }, runId, false, options.entry.inputValues.map(value => JSON.stringify(value)).join(","));
}

/** Return the captured run even when its independent verifier or retire step fails. */
export function openGoalOutcomeCode(options: Parameters<typeof openGoalTeacherCode>[0], runId: string) {
  return `
    import { assessSemanticOutcome } from "@workspace/application-outcomes/semantic-outcome-contract";
    import { observeInvocation } from "@workspace/application-outcomes/observed-invocation";
    import { createNatlangRecordsClient } from "@workspace/natlang-records/client";
    ${options.bindingCode}
    let teacher, verification = null;
    const verificationErrors = [];
    const recordFailure = (phase, error) => verificationErrors.push({
      phase,
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      ${openGoalTeacherCode({ ...options, bindingCode: "" }, runId)}
      teacher = utilityValue;
      try {
        const actualResult = teacher.report;
        const records = createNatlangRecordsClient(rpc);
        const observations = observeInvocation(teacher, hash => records.getValue(hash));
        verification = await prepared.verify(actualResult, observations);
        verification = {
          ...assessSemanticOutcome(verification, ${JSON.stringify(options.outcomeContract)}),
          entry: teacher.entry,
          actualResult: teacher.applicationResultKind === "void" ? null : actualResult,
          ...(teacher.applicationResultKind === "void" ? { actualResultKind: "void" } : {}),
        };
      }
      catch (error) { recordFailure("verification", error); }
    } finally {
      try { await prepared.close?.(); }
      catch (error) {
        if (!teacher) throw error;
        recordFailure("retirement", error);
      }
    }
    const utilityValue = { teacher, verification, verificationErrors, contextId: actualContextId };
  `;
}

/** Keep the complete report for goals that require several skills. */
export function composedTeacherCode<Options extends ComposedTeacherOptions>(
  options: Options,
  runId: string,
): string {
  return captureWorkflow(options, runId, false, options.requestCode);
}

function captureWorkflow(
  options: ComposedTeacherOptions,
  runId: string,
  single: boolean,
  requestCode = JSON.stringify(options.workflowRequest),
): string {
  const domains = options.workflowRequest.work
    .filter((item): item is DomainAssignment => item.kind === "domain")
    .map(({ domain, operation }) => ({ domain, operation }));
  const assigned = options.workflowRequest.work
    .map((item) => (item.kind === "domain" ? item.operation : item.kind))
    .sort();
  const assignmentKey = (item: Assignment) =>
    item.kind === "domain" ? item.domain + "/" + item.operation : item.kind;
  const held = Object.entries(options.heldAssignments ?? {});
  const active = options.workflowRequest.work.filter(
    (item) => !held.some(([name]) => name === assignmentKey(item)),
  );
  const expected = active.map((item) => item.kind === "domain" ? item.operation : item.kind).sort();
  const expectedAssignments = active.map(assignmentKey).sort();
  const expectedRemaining = held.map(([, reason]) => reason).sort();
  if (
    (!options.openGoal && !expected.length) ||
    new Set(assigned).size !== assigned.length ||
    held.length !== assigned.length - expected.length ||
    expectedRemaining.some((reason) => !reason.trim()) ||
    new Set(expectedRemaining).size !== expectedRemaining.length ||
    (options.requiredOrder &&
      JSON.stringify([...options.requiredOrder].sort()) !==
        JSON.stringify(expected))
  )
    throw new Error(
      "Declare unique assignments and holds, and order only the skills that must run",
    );
  return `
${options.bindingCode}
      natlang.captureModelTurns({executorModel:${JSON.stringify(options.executorModel)}});
      const programPath=${JSON.stringify(options.openGoal ? options.entry!.program : "skills/vibestudio-workflows/runWorkflow.nl")};
      const expectedSkills=${JSON.stringify(expected)}, expectedAssignments=${JSON.stringify(expectedAssignments)}, requiredOrder=${JSON.stringify(options.requiredOrder ?? null)};
      const expectedRemaining=${JSON.stringify(expectedRemaining)};
      let report=null, applicationResult, applicationResultKind, applicationReturned=false, executionError=null;
      try {
        const loaded=await natlang.load(programPath,{services:assignedServices});
        const root=programPath.endsWith(".ts")?loaded?.default:loaded;
        if(typeof root!=="function") throw new Error("The authored entry has no callable "+(programPath.endsWith(".ts")?"default export":"NL function"));
        ${options.openGoal && options.entry!.program.endsWith(".ts") ? `if(root.name!==${JSON.stringify(options.entry!.callable)}) throw new Error("The authored TypeScript default export differs from the assigned callable");` : ""}
        ${requireMountedDomains(domains)}
        const workflow=await root(${requestCode});
        applicationReturned=true;
        applicationResult=workflow===undefined?null:workflow;
        applicationResultKind=workflow===undefined?"void":undefined;
        ${options.openGoal ? "report=workflow;" : `
        const returnedSkills=workflow.results.map(result=>result.kind==="domain"?result.domain+"/"+result.operation:result.kind);
        if(JSON.stringify([...returnedSkills].sort())!==JSON.stringify(expectedAssignments) ||
           JSON.stringify([...workflow.remaining].sort())!==JSON.stringify(expectedRemaining) ||
           (requiredOrder && JSON.stringify(workflow.results.map(result=>result.kind==="domain"?result.operation:result.kind))!==JSON.stringify(requiredOrder)))
          throw new Error("The shared workflow did not return the required results and holds");
        report=${single ? "workflow.results[0].report" : "workflow"};`}
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
      if(!rootRecord || rootRecord.definition.name!==${JSON.stringify(options.openGoal ? options.entry!.callable : "runWorkflow")}) captureErrors.push("The authored workflow root was not observed");
      const rootOutcome=rootRecord?.outcome??null;
      if(rootRecord && rootOutcome!=="done" && executionError===null)
        executionError={name:"AuthoredExecutionFailure",message:"Assigned authored root ended with "+rootOutcome};
      let utilityValue={report,...(applicationReturned?{applicationResult,...(applicationResultKind===undefined?{}:{applicationResultKind})}:{}),${options.openGoal ? `entry:${JSON.stringify({program:options.entry!.program,callable:options.entry!.callable,resultType:options.entry!.resultType,arguments:options.entry!.arguments,argumentJson:Object.fromEntries(options.entry!.parameterNames.map(name=>[name,JSON.stringify(options.entry!.arguments[name])]))})},` : ""}executionError,rootOutcome,captureErrors,rootCallIds,calls,evalRunId:${JSON.stringify(runId)},programPath,
        // Capture eligibility is independent of goal success and root completion.
        // Independent domain evidence determines usable whole or partial work.
        trainingEligible:captureErrors.length===0};
  `;
}
