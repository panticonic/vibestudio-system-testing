export type ExamplesAdoptionWorld = ReturnType<typeof caseOf>;
type Mode =
  | "clean"
  | "replace"
  | "unclaimed"
  | "wrong-owner"
  | "epoch"
  | "missing"
  | "duplicate"
  | "settings"
  | "floor"
  | "transitive"
  | "parent";
type Status =
  | "composed"
  | "conflict"
  | "bad-override"
  | "epoch"
  | "missing-unit"
  | "duplicate-source";
type Disposition =
  | "record-private"
  | "explain-only"
  | "hold-authority"
  | "hold-conflict"
  | "hold-override"
  | "hold-epoch"
  | "hold-closure"
  | "hold-duplicate"
  | "hold-stale";
type Profile = {
  requestedReturnRequired: boolean;
  requestedArtifact: "required" | "conditional" | "none";
  mode: Mode;
  unit:
    | "panels/grimoire"
    | "panels/regency"
    | "panels/hello-svelte"
    | "panels/hello-vanilla"
    | "panels/wandering-house"
    | "panels/dead-letter-office"
    | "workers/sample-do"
    | "panels/missing-country";
  mayRecord: boolean;
  during?: true;
  status: Status;
  disposition: Disposition;
  proof?: readonly string[];
};
function caseOf(
  id: string,
  split: "train" | "test",
  name: string,
  goal: string,
  profile: Profile,
) {
  return {
    id: "examples-adoption-" + id,
    sourceGroup: "vibestudio:examples-adoption:" + id,
    kind: "examplesAdoption",
    workspace: "examples",
    split,
    name,
    goal,
    ...profile,
  } as const;
}
export const openExamplesAdoptionWorlds = [
  caseOf(
    "garden-layer-certificate",
    "train",
    "Garden Preview",
    "Keep a private proof of which prepared file actually supplies the Garden Preview panel. Follow the staged Examples composition and leave main alone.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "clean",
      unit: "panels/grimoire",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["panels/grimoire/review-candidate.ts"],
    },
  ),
  caseOf(
    "regency-owner-only",
    "train",
    "Regency Exhibit",
    "Tell me which layer will serve the Regency Exhibit panel after the reviewed stack is composed. I want an answer in chat and no new artifact.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "clean",
      unit: "panels/regency",
      mayRecord: false,
      status: "composed",
      disposition: "explain-only",
      proof: ["Examples"],
    },
  ),
  caseOf(
    "whole-replacement-svelte",
    "train",
    "Svelte Counter Review",
    "Keep a local composition record for Svelte Counter Review only if the Examples layer really owns the whole replacement and an old parent file cannot leak into it. Identify the candidate file that survives.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "replace",
      unit: "panels/hello-svelte",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["Examples", "panels/hello-svelte/review-candidate.ts"],
    },
  ),
  caseOf(
    "orphaned-image-guard",
    "train",
    "The Art Alcove",
    "The Art Alcove steward wants to know whether the dependency still owns the garden panel and its old source when the Examples draft supplies no replacement. Leave a private readback.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "parent",
      unit: "panels/grimoire",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["Base", "panels/grimoire/review-parent.ts"],
    },
  ),
  caseOf(
    "colliding-post-office",
    "train",
    "Post Office Assembly",
    "Can the prepared Post Office Assembly be accepted when both layers appear to own its mailbox panel? If ownership never resolves, tell me which native conflict prevents adoption.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "unclaimed",
      unit: "panels/dead-letter-office",
      mayRecord: true,
      status: "conflict",
      disposition: "hold-conflict",
    },
  ),
  caseOf(
    "wrong-upstream-house",
    "train",
    "Wandering House Review",
    "A replacement for Wandering House Review says it takes ownership from a companion template. Check that this is actually the dependency that owns the staged unit before recording anything.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "wrong-owner",
      unit: "panels/wandering-house",
      mayRecord: true,
      status: "bad-override",
      disposition: "hold-override",
    },
  ),
  caseOf(
    "older-epoch-worker",
    "train",
    "Sample Worker Demonstration",
    "Can the already staged Sample Worker Demonstration run in the current Examples epoch? Stop if its source layer disagrees, even though the panel list looks ordinary.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "epoch",
      unit: "workers/sample-do",
      mayRecord: true,
      status: "epoch",
      disposition: "hold-epoch",
    },
  ),
  caseOf(
    "missing-comparator",
    "train",
    "Counter Comparator",
    "The Exceptions section claims Counter Comparator has its shared formatter. Verify the package closure in the staged composition and withhold a record if the dependency has no owner.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "missing",
      unit: "panels/hello-vanilla",
      mayRecord: true,
      status: "missing-unit",
      disposition: "hold-closure",
    },
  ),
  caseOf(
    "two-client-declarations",
    "train",
    "Travel Lesson",
    "Investigate why Travel Lesson's source can be present while the candidate manifest still fails. Report the conflicting native declaration before anyone can adopt the Examples launch.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "duplicate",
      unit: "panels/missing-country",
      mayRecord: true,
      status: "duplicate-source",
      disposition: "hold-duplicate",
    },
  ),
  caseOf(
    "inherit-model-slot",
    "train",
    "Readback Settings Card",
    "Make a private Readback Settings Card that says which model slot still comes through from the Base layer after the candidate tunes its thinking level. Don't treat the whole configuration as replaced.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "settings",
      unit: "panels/hello-vanilla",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["defaultAgentConfig.model=openai-codex:gpt-6.1-sol"],
    },
  ),
  caseOf(
    "setting-override-chat",
    "train",
    "Museum Kiosk Settings",
    "What thinking level does Museum Kiosk Settings actually use once the Examples layer is applied? Answer here, since we aren't keeping a checklist.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "settings",
      unit: "panels/hello-svelte",
      mayRecord: false,
      status: "composed",
      disposition: "explain-only",
      proof: ["defaultAgentConfig.thinkingLevel=medium"],
    },
  ),
  caseOf(
    "app-floor-retained",
    "train",
    "Vanilla Desk Floor",
    "Leave a private note of the effective minimum app version in Vanilla Desk Floor. The top template lists a lower version than its dependency, so compute the version that actually applies.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "floor",
      unit: "panels/hello-vanilla",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["0.1.120"],
    },
  ),
  caseOf(
    "transitive-review-helper",
    "train",
    "Garden Package Walk",
    "List both dependencies that will actually be pulled in for Garden Package Walk. Its public unit only names one directly but I need the full private record for review.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "transitive",
      unit: "panels/grimoire",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["packages/review-adapter", "packages/review-types"],
    },
  ),
  caseOf(
    "positive-only-no-authority",
    "train",
    "Approval Desk",
    "If Approval Desk has the composed sample worker, leave me a private proof. The scope card may say we can inspect it but cannot keep a record, so check before creating anything.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "conditional",
      mode: "clean",
      unit: "workers/sample-do",
      mayRecord: false,
      status: "composed",
      disposition: "hold-authority",
      proof: ["workers/sample-do/review-candidate.ts"],
    },
  ),
  caseOf(
    "restaged-working-frontier",
    "train",
    "Arrival Board",
    "Please keep the exact adoption evidence for Arrival Board, but only if the semantic review I asked about is still the current one when you hand it over. Pause if it was restaged.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "conditional",
      mode: "clean",
      unit: "panels/regency",
      mayRecord: true,
      during: true,
      status: "composed",
      disposition: "hold-stale",
    },
  ),
  caseOf(
    "parent-file-readback",
    "train",
    "Original Office Source",
    "Without leaving a file, identify the original Office source that will remain in the composed tree when the review is limited to an Examples presentation layer.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "parent",
      unit: "panels/dead-letter-office",
      mayRecord: false,
      status: "composed",
      disposition: "explain-only",
      proof: ["panels/dead-letter-office/review-parent.ts"],
    },
  ),
  caseOf(
    "replace-private-house",
    "train",
    "House Candidate Receipt",
    "Make a locally retained receipt that says which template owns House Candidate Receipt. The approved replacement is for the whole unit, so keep the existing working deployment undisturbed.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "replace",
      unit: "panels/wandering-house",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["Examples"],
    },
  ),
  caseOf(
    "settings-two-slots",
    "train",
    "Conservatory Runtime",
    "For Conservatory Runtime, keep the effective model and thinking-level defaults side by side in a private evidence file so the review board can tell whether the slide's settings claim is true.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "settings",
      unit: "panels/grimoire",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: [
        "defaultAgentConfig.model=openai-codex:gpt-6.1-sol",
        "defaultAgentConfig.thinkingLevel=medium",
      ],
    },
  ),
  caseOf(
    "held-ownership-duplicate",
    "test",
    "A Keep Without a Deed",
    "Two otherwise plausible layers include the keep's exact panel. Confirm whether A Keep Without a Deed has a valid owner before making any private receipt.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "unclaimed",
      unit: "panels/regency",
      mayRecord: true,
      status: "conflict",
      disposition: "hold-conflict",
    },
  ),
  caseOf(
    "held-installed-floor",
    "test",
    "Listener App Check",
    "I am on a call about Listener App Check. Which minimum app version should I quote for this stack, after joining the dependent Examples manifest with the stronger Base requirement? I don't need a file.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "floor",
      unit: "panels/wandering-house",
      mayRecord: false,
      status: "composed",
      disposition: "explain-only",
      proof: ["0.1.120"],
    },
  ),
  caseOf(
    "held-nested-dependency-receipt",
    "test",
    "Map Shelf Handoff",
    "Write a local handoff that shows how the Map Shelf Handoff's staged copy brings in its adapter and the adapter's type package. I need both pulled-in units, and no adoption.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "transitive",
      unit: "panels/missing-country",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: ["packages/review-adapter", "packages/review-types"],
    },
  ),
  caseOf(
    "held-replacement-old-fragment",
    "test",
    "Night Exhibit Record",
    "Check that the Night Exhibit Record actually contains the Examples package and its staged scene source after the whole replacement. Leave the candidate file proof privately without creating an installation.",
    {
      requestedReturnRequired: false,
      requestedArtifact: "required",
      mode: "replace",
      unit: "panels/grimoire",
      mayRecord: true,
      status: "composed",
      disposition: "record-private",
      proof: [
        "panels/grimoire/package.json",
        "panels/grimoire/review-candidate.ts",
      ],
    },
  ),
  caseOf(
    "held-dependency-swap-changed",
    "test",
    "The Superseded Graph",
    "The Superseded Graph compiles in the earlier review. Keep a record only if that semantic frontier still holds after the next update; otherwise identify the live review as a hold.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "conditional",
      mode: "transitive",
      unit: "panels/hello-svelte",
      mayRecord: true,
      during: true,
      status: "composed",
      disposition: "hold-stale",
    },
  ),
  caseOf(
    "held-client-source-collision",
    "test",
    "Duplicate Desk Registration",
    "Duplicate Desk Registration has one repository owner on paper but apparently incompatible client declarations. Determine whether the composed manifest can be used, even if someone granted a private report.",
    {
      requestedReturnRequired: true,
      requestedArtifact: "none",
      mode: "duplicate",
      unit: "panels/hello-svelte",
      mayRecord: true,
      status: "duplicate-source",
      disposition: "hold-duplicate",
    },
  ),
] as const;
