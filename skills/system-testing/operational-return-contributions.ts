import type {ApplicationReturnContribution} from "@workspace/application-outcomes/observed-application-outcome";
export const intentOutcomeContributions:readonly ApplicationReturnContribution[]=[{checks:["exactIntentOutcome"],rootPath:["outcome"],producerSourceSuffix:"discoverScopedIntent/concludeIntentReview.nl",producerPath:[]}];
export const packageResultContributions:readonly ApplicationReturnContribution[]=[
 {checks:["returnedPackageFinding"],rootPath:["finding"],producerSourceSuffix:"reviewInstalledPackage/decidePackage.nl",producerPath:[]},
 {checks:["returnedPackageRepair"],rootPath:["repair"],producerSourceSuffix:"reviewInstalledPackage/restorePackage.nl",producerPath:[]},
 {checks:["returnedPackageVerification"],rootPath:["verification"],producerSourceSuffix:"reviewInstalledPackage/reviewVerification.nl",producerPath:[]},
];
