import type { SemanticOutcomeContract } from "@workspace/application-outcomes/semantic-outcome-contract";

/** These goals request a private artifact or an authorization-preserving hold.
 * The final explanatory disposition can honestly flag further local review. */
export const preparedContentProjectOutcomeContract: SemanticOutcomeContract = {
  effects: {
    checks: ["exactOwnedSourceDiscovery", "genuineEvidenceDisposition", "exactScopedAuthorization", "exactArtifactOrReadOnlyHold", "protectedPrivateBoundary"],
    rationale: "The requested private project or hold is established by independent source, authorization, artifact and private workspace observations.",
  },
  returnedValue: {
    checks: ["actualProjectResult"], required: true,
    rationale: "The result must identify the actual private project, document paths and local event, or the actual authorization-preserving hold.",
  },
};
