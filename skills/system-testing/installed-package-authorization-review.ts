type State={workingRevision:string;workingDigest:string;baselineDigest:string;scopeMatches:boolean};
/** Pure projection of actual native chronology, shared by live verification and
 * immutable-capture reassessment. It confers no authority and changes no check. */
export function installedPackageAuthorization(input:{operationId:string;scope:unknown;before:State|null;action:{status:string}|null;after:State}) {
 const snapshot=(state:State)=>({workingRevision:state.workingRevision,workingDigest:state.workingDigest,baselineDigest:state.baselineDigest,scopeMatches:state.scopeMatches});
 return {operationId:input.operationId,scope:input.scope,before:input.before?snapshot(input.before):null,action:input.action?{status:input.action.status}:null,after:snapshot(input.after)};
}
