import {isDeepStrictEqual} from "node:util";
import {assessSemanticOutcome,type SemanticOutcomeContract} from "./semantic-outcome-contract.js";
import type {InvocationObservations} from "./observed-invocation.js";

/** Separate native effects and requested values, binding any bad return to its actual trace source. */
export async function assessObservedApplicationOutcome<T extends {passed:boolean;checks:Record<string,boolean>}>(
  verification:T,contract:SemanticOutcomeContract,actualValue:unknown,invocation?:InvocationObservations,
) {
  const wrongRequested=contract.returnedValue.checks.some(name=>verification.checks[name]!==true);
  const wrongIncidental=(contract.incidentalValues?.checks??[]).some(name=>verification.checks[name]!==true);
  const incorrectReturnValues=(wrongRequested||wrongIncidental)&&invocation ?
    (await invocation.returns(call=>call.parentCallId===null)).filter(row=>isDeepStrictEqual(row.value,actualValue))
      .map(({definition,value})=>({definition,value,required:contract.returnedValue.required&&wrongRequested})) : [];
  return assessSemanticOutcome({...verification,incorrectReturnValues},contract);
}
