import type {ApplicationReturnContribution} from "./observed-application-outcome.js";
export const intentOutcomeContributions:readonly ApplicationReturnContribution[]=[{checks:["exactIntentOutcome"],rootPath:["outcome"],producerSourceSuffix:"discoverScopedIntent/concludeIntentReview.nl",producerPath:[]}];
export const packageResultContributions:readonly ApplicationReturnContribution[]=[
 {checks:["returnedPackageFinding"],rootPath:["finding"],producerSourceSuffix:"reviewInstalledPackage/decidePackage.nl",producerPath:[]},
 {checks:["returnedPackageRepair"],rootPath:["repair"],producerSourceSuffix:"reviewInstalledPackage/restorePackage.nl",producerPath:[]},
 {checks:["returnedPackageVerification"],rootPath:["verification"],producerSourceSuffix:"reviewInstalledPackage/reviewVerification.nl",producerPath:[]},
];
export function assetFindingContributions(count:number,includesPlanFinding:boolean):ApplicationReturnContribution[]{
 return [
  ...(includesPlanFinding?[{checks:["matchedAssetDisposition"],rootPath:["reason"],producerSourceSuffix:"reviewAssetIntegrity/planRecovery.nl",producerPath:["reason"]}]:[]),
  ...Array.from({length:count},(_,index)=>({checks:[`assetFinding:${index}`],rootPath:["findings",index],producerSourceSuffix:"reviewAssetIntegrity/compareAsset.nl",producerPath:[]})),
 ];
}
