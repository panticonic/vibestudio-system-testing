type JournalEntry={service:string;method:string;args:unknown[];result:unknown};
/** Successful effects bind their original admitted receipt, not a later refused retry. */
export function projectAuthorizationEvidence(journal:readonly JournalEntry[],receipt:string|undefined){
 const admitted=receipt ? journal.find(entry=>entry.service==='contentProjectScope' && entry.method==='confirm' &&
  (entry.result as {status?:string;receipt?:string}|null)?.status==='admitted' && (entry.result as {receipt?:string}).receipt===receipt) : undefined;
 const effects=journal.filter(entry=>entry.result!=null && (entry.service==='contentProjectDraft' && ['prepare','write'].includes(entry.method) || entry.service==='contentProjectCommit' && entry.method==='commit'));
 return {admittedScope:admitted?.result??null,effectsUseAdmittedReceipt:effects.every(entry=>receipt!==undefined && entry.args[0]===receipt)};
}
