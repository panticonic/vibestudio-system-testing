import {isDeepStrictEqual as exact} from "node:util";
import type {RouteAuthorityObservation,RouteAuthorityReport} from "@workspace-skills/open-route-authority/types";

export function compareExactAuthority(observations:RouteAuthorityObservation[],ceiling:RouteAuthorityReport["protectedLeaves"]):RouteAuthorityReport {
  const protectedLeaves:RouteAuthorityReport["protectedLeaves"]=[];
  const reviews:RouteAuthorityReport["reviews"]=observations.map(observation=>{
    const scoped=observation.leaves.filter(leaf=>leaf.tier==="gated"||leaf.tier==="critical")
      .map(({capability,resourceKey})=>({capability,resourceKey}));
    for(const row of scoped)if(!protectedLeaves.some(known=>exact(known,row)))protectedLeaves.push(row);
    const outside=scoped.filter(row=>!ceiling.some(allowed=>exact(allowed,row)));
    const disposition=outside.length?"outside-ceiling":observation.decision==="denied"?"host-denied":
      observation.decision==="acquirable"?"needs-acquisition":"eligible";
    return {observation,outside,disposition};
  });
  const held=reviews.filter(row=>row.disposition==="outside-ceiling"||row.disposition==="host-denied")
    .map(row=>row.observation.operationId);
  return {status:held.length?"held":reviews.some(row=>row.disposition==="needs-acquisition")?"needs-acquisition":"eligible",
    protectedLeaves,held,reviews};
}

