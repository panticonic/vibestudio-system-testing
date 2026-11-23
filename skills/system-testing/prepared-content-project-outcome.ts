import type { SemanticOutcomeContract } from "./semantic-outcome-contract.js";

/** These goals request a private artifact or an authorization-preserving hold.
 * The final explanatory disposition can honestly flag further local review. */
export const preparedContentProjectOutcomeContract: SemanticOutcomeContract = {
  effects: {
    checks: ["exactOwnedSourceDiscovery", "genuineEvidenceDisposition", "exactScopedAuthorization", "exactArtifactOrReadOnlyHold", "protectedPrivateBoundary"],
    rationale: "The requested private project or hold is established by independent source, authorization, artifact and private workspace observations.",
  },
  returnedValue: {
    checks: ["correctOutcomeReport"], required: false,
    rationale: "These goals request retained project state, not a particular final disposition word or explanatory summary. A retained draft may truthfully still need review.",
  },
};
