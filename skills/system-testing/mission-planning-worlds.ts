export const missionProjects = [
  { key: "build", name: "Build" },
  { key: "qa", name: "Quality" },
  { key: "ops", name: "Operations" },
  { key: "archive", name: "Past work", archived: true },
] as const;

export const missionCards = [
  {
    key: "design",
    project: "build",
    title: "Design review",
    status: "done",
    requires: [],
  },
  {
    key: "implement",
    project: "build",
    title: "Implement migration",
    status: "inbox",
    requires: ["design"],
  },
  {
    key: "build-launch",
    project: "build",
    title: "Launch",
    status: "inbox",
    requires: ["implement"],
  },
  {
    key: "rollback",
    project: "build",
    title: "Rollback procedure",
    status: "active",
    requires: ["design"],
  },
  {
    key: "qa-signoff",
    project: "qa",
    title: "Sign-off",
    status: "done",
    requires: [],
  },
  {
    key: "qa-launch",
    project: "qa",
    title: "Launch",
    status: "inbox",
    requires: ["qa-signoff"],
  },
  {
    key: "qa-matrix",
    project: "qa",
    title: "Verification matrix",
    status: "inbox",
    requires: ["implement"],
  },
  {
    key: "train",
    project: "ops",
    title: "Prepare training",
    status: "inbox",
    requires: ["design", "qa-signoff"],
  },
  {
    key: "release",
    project: "ops",
    title: "Release coordination",
    status: "inbox",
    requires: ["build-launch", "qa-launch"],
  },
  {
    key: "old",
    project: "archive",
    title: "Past release",
    status: "done",
    requires: [],
  },
] as const;

type Ref = { title: string; project?: string };
const ref = (title: string, project?: string): Ref =>
  project ? { title, project } : { title };
const design = ref("Design review");
const implementation = ref("Implement migration");
const buildLaunch = ref("Launch", "Build");
const qaLaunch = ref("Launch", "Quality");
const setup = ref("Rollback procedure");
const signoff = ref("Sign-off");
const matrix = ref("Verification matrix");
const training = ref("Prepare training");
const release = ref("Release coordination");
const ready = (target: Ref) => ({ kind: "ready" as const, target });
const relocate = (target: Ref, destination: string) => ({
  kind: "relocate" as const,
  target,
  destination,
});
const prerequisites = (target: Ref, ...requires: Ref[]) => ({
  kind: "prerequisites" as const,
  target,
  requires,
});
type Proposal = ReturnType<
  typeof ready | typeof relocate | typeof prerequisites
>;
type Outcome =
  | { kind: "held"; codes: string[] }
  | { kind: "ready"; key: string }
  | { kind: "relocate"; key: string; project: string }
  | { kind: "prerequisites"; key: string; requires: string[] };
const hold = (...codes: string[]): Outcome => ({ kind: "held", codes });
const queued = (key: string): Outcome => ({ kind: "ready", key });
const moved = (key: string, project: string): Outcome => ({
  kind: "relocate",
  key,
  project,
});
const links = (key: string, ...requires: string[]): Outcome => ({
  kind: "prerequisites",
  key,
  requires,
});
const world = (id: string, goal: string, ...steps: [Proposal, Outcome][]) => ({
  id,
  request: { goal, proposals: steps.map(([proposal]) => proposal) },
  expected: steps.map(([, outcome]) => outcome),
});

export const managedMissionPlanningWorlds = [
  world(
    "implement-after-design",
    "Queue the implementation with the completed review, then keep Launch waiting on implementation.",
    [ready(implementation), queued("implement")],
    [ready(buildLaunch), hold("implement")],
  ),
  world(
    "qualified-launch-readiness",
    "Evaluate both Launch cards in their own projects and advance just the one whose prerequisite is accepted.",
    [ready(buildLaunch), hold("implement")],
    [ready(qaLaunch), queued("qa-launch")],
  ),
  world(
    "unqualified-title-hold",
    "Hold a cross-project Launch request without a board qualifier. The qualified Quality task can enter review preparation.",
    [ready(ref("Launch")), hold("target-not-unique")],
    [ready(qaLaunch), queued("qa-launch")],
  ),
  world(
    "move-then-resolve-by-new-project",
    "Relocate implementation to Operations, then use its new project to prepare it for review.",
    [relocate(implementation, "Operations"), moved("implement", "ops")],
    [ready(ref("Implement migration", "Operations")), queued("implement")],
  ),
  world(
    "moved-card-keeps-release-links",
    "Move release coordination to Build while retaining both cross-project gates.",
    [relocate(release, "Build"), moved("release", "build")],
    [
      ready(ref("Release coordination", "Build")),
      hold("build-launch", "qa-launch"),
    ],
  ),
  world(
    "direct-cycle-holds-independent-readiness",
    "Refuse a self-link for implementation and still prepare QA Launch using its accepted sign-off.",
    [prerequisites(implementation, implementation), hold("cycle")],
    [ready(qaLaunch), queued("qa-launch")],
  ),
  world(
    "two-hop-cycle-across-projects",
    "Hold an implementation dependency that comes back through QA, then move QA's matrix to Operations without altering its prerequisite.",
    [prerequisites(implementation, matrix), hold("cycle")],
    [relocate(matrix, "Operations"), moved("qa-matrix", "ops")],
  ),
  world(
    "three-hop-cycle-across-projects",
    "Reject the release loop that would lead from implementation through coordination and Launch back to implementation.",
    [prerequisites(implementation, release), hold("cycle")],
    [ready(training), queued("train")],
  ),
  world(
    "retarget-prerequisites-then-queue",
    "Use accepted design and sign-off in place of the matrix's obsolete implementation gate.",
    [
      prerequisites(matrix, design, signoff),
      links("qa-matrix", "design", "qa-signoff"),
    ],
    [ready(matrix), queued("qa-matrix")],
  ),
  world(
    "order-prerequisite-ids",
    "Order the accepted sign-off before Design review in the training plan and put the task in Ready.",
    [
      prerequisites(training, signoff, design),
      links("train", "qa-signoff", "design"),
    ],
    [ready(training), queued("train")],
  ),
  world(
    "deduplicate-prerequisite-references",
    "Resolve repeated references to one signed QA gate rather than duplicating it.",
    [
      prerequisites(training, signoff, signoff, design),
      links("train", "qa-signoff", "design"),
    ],
    [relocate(training, "Quality"), moved("train", "qa")],
  ),
  world(
    "clear-a-replaced-dependency-list",
    "The owner confirms the matrix has no remaining direct dependencies. Clear the replaced list and queue it.",
    [prerequisites(matrix), links("qa-matrix")],
    [ready(matrix), queued("qa-matrix")],
  ),
  world(
    "preserve-active-task-gates",
    "Do not add an unfinished prerequisite to the active rollback task. Its existing accepted gates may be reordered.",
    [prerequisites(setup, implementation), hold("active-dependency")],
    [
      prerequisites(setup, signoff, design),
      links("rollback", "qa-signoff", "design"),
    ],
  ),
  world(
    "same-project-move-holds",
    "Leave the implementation in Build when the request points to its existing project and advance it based on design acceptance.",
    [relocate(implementation, "Build"), hold("already-in-project")],
    [ready(implementation), queued("implement")],
  ),
  world(
    "archived-destination-holds",
    "Keep the release card out of archived work and retain its original dependency record.",
    [relocate(release, "Past work"), hold("destination-not-unique")],
    [ready(release), hold("build-launch", "qa-launch")],
  ),
  world(
    "unassigned-destination-holds",
    "Reject an unknown destination and move the rollback task into the assigned Operations project.",
    [relocate(setup, "Unassigned"), hold("destination-not-unique")],
    [relocate(setup, "Operations"), moved("rollback", "ops")],
  ),
  world(
    "missing-prerequisite-holds",
    "Avoid adding a nonexistent compliance gate. Place training in Quality for its existing reviewers.",
    [
      prerequisites(training, ref("Compliance token")),
      hold("prerequisite-not-unique"),
    ],
    [relocate(training, "Quality"), moved("train", "qa")],
  ),
  world(
    "archived-prerequisite-holds",
    "Keep the archived release card out of this active matrix's prerequisites while preserving the option to move the matrix.",
    [
      prerequisites(matrix, ref("Past release", "Past work")),
      hold("prerequisite-not-unique"),
    ],
    [relocate(matrix, "Build"), moved("qa-matrix", "build")],
  ),
  world(
    "do-not-requeue-a-done-card",
    "Do not turn completed Design review back into a ready item. Queue its implementation dependency consumer.",
    [ready(design), hold("card-not-in-inbox")],
    [ready(implementation), queued("implement")],
  ),
  world(
    "relocation-reveals-title-ambiguity",
    "Move QA's Launch into Build. Both Launch cards now share the same project and title, so a title-only readiness request must be held.",
    [relocate(qaLaunch, "Build"), moved("qa-launch", "build")],
    [ready(ref("Launch", "Build")), hold("target-not-unique")],
  ),
  world(
    "stale-project-after-relocation",
    "Move training into Build, hold a later request using its old project, and allow the corrected reference.",
    [relocate(training, "Build"), moved("train", "build")],
    [ready(ref("Prepare training", "Operations")), hold("target-not-unique")],
    [ready(ref("Prepare training", "Build")), queued("train")],
  ),
  world(
    "ready-is-not-done",
    "Queue the qualified Launch task when allowed, but keep coordination waiting because entering Ready is not acceptance.",
    [ready(qaLaunch), queued("qa-launch")],
    [ready(release), hold("build-launch", "qa-launch")],
  ),
  world(
    "rewire-then-recheck-release",
    "Replace the release blockers with the approved Design and Quality gates, verify the new dependencies, then queue the release.",
    [
      prerequisites(release, design, signoff),
      links("release", "design", "qa-signoff"),
    ],
    [ready(release), queued("release")],
  ),
  world(
    "cross-project-reconcile-and-relocate",
    "Unblock implementation with QA's accepted sign-off, relocate it for the next owner, and prepare the same stable card in the new project.",
    [prerequisites(implementation, signoff), links("implement", "qa-signoff")],
    [relocate(implementation, "Quality"), moved("implement", "qa")],
    [ready(ref("Implement migration", "Quality")), queued("implement")],
  ),
];
