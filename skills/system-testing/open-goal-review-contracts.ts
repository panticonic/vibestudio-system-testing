import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
/** Shared source-owned contracts for live verification and immutable-capture reassessment.
 * This declares requested returns; it never invents native checks or passed evidence. */

export function installedPackageGoalContract(world:{requestedReturnRequired:boolean}):SemanticOutcomeContract {return {
        effects:{checks:["boundOwnedInstallation", "usedExactPackageBaseline", "honoredReviewAssignment", "verifiedLocalManifestEffect", "exactStateVerificationPlan", "preservedProtectedAndNeighbors"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["returnedPackageFinding"],required:world.requestedReturnRequired,rationale:"The unchanged literal goal declares whether it requests an answer, including runner/suite identification after an edit."},
        incidentalValues:{checks:["returnedPackageRepair","returnedPackageVerification"],rationale:"Native pass-through receipt/plan copies do not replace the requested finding; actual native effect and verification ownership remain independently checked."}};}

export function systemReleaseGoalContract(world:{requestedReturnRequired:boolean}):SemanticOutcomeContract {return {
        effects:{checks:["retainedNativeRunPair", "matchedOwnedBuildAndAttempt", "exactRequiredCaseEvidence", "verifiedPrivateHandoff", "noSuiteRerunOrUnassignedCase"],rationale:"Native observations, captured writes, persisted bytes and protected state establish these facts independently of the public result."},
        returnedValue:{checks:["matchedReleaseDisposition"],required:world.requestedReturnRequired,rationale:"The unchanged literal goal declares whether it requests a returned finding; a requested local diagnostic may convey its explanation in retained structured evidence."},
        incidentalValues:{checks:[],rationale:"Known incorrect emitted application values are masked using their actual invocation definition."}};}
