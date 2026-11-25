export type Drift =
  | "same"
  | "move"
  | "overwrite"
  | "lost"
  | "replace"
  | "clone"
  | "mode"
  | "move-bytes"
  | "move-mode";
export type AssetDifference =
  | "same"
  | "moved"
  | "bytes"
  | "mode"
  | "missing"
  | "replaced"
  | "manifest";
export type AssetSeed = {
  key: string;
  path: string;
  output: string;
  format: "wav" | "pgm" | "bin";
  drift: Drift;
  badClaim?: "digest" | "mode" | "missing";
};
type Options = {
  copies?: string[];
  permitted?: string[];
  reason?: string[];
  release?: "verified" | "review" | "blocked";
  coedit?: "refresh" | "pinned";
  held?: boolean;
};
const wave = (
  key: string,
  drift: Drift,
  badClaim?: AssetSeed["badClaim"],
): AssetSeed => ({
  key,
  path: "audio/" + key + ".wav",
  output: key + ".wav",
  format: "wav",
  drift,
  ...(badClaim ? { badClaim } : {}),
});
const map = (
  key: string,
  drift: Drift,
  badClaim?: AssetSeed["badClaim"],
): AssetSeed => ({
  key,
  path: "images/" + key + ".pgm",
  output: key + ".pgm",
  format: "pgm",
  drift,
  ...(badClaim ? { badClaim } : {}),
});
const data = (
  key: string,
  drift: Drift,
  badClaim?: AssetSeed["badClaim"],
): AssetSeed => ({
  key,
  path: "records/" + key + ".bin",
  output: key + ".bin",
  format: "bin",
  drift,
  ...(badClaim ? { badClaim } : {}),
});

const expectedKinds: Record<Drift, AssetDifference[]> = {
  same: ["same"],
  move: ["moved"],
  overwrite: ["bytes"],
  lost: ["missing"],
  replace: ["replaced"],
  clone: ["replaced"],
  mode: ["mode"],
  "move-bytes": ["moved", "bytes"],
  "move-mode": ["moved", "mode"],
};
function assetCase(
  id: string,
  group: string,
  bundle: string,
  goal: string,
  requestedReturnRequired: boolean,
  assets: AssetSeed[],
  options: Options = {},
) {
  const copies = options.copies ?? [];
  const findings = assets.map((asset) => ({
    key: asset.key,
    differences:
      asset.badClaim === "missing"
        ? ["manifest" as const]
        : asset.badClaim
          ? [
              ...(asset.drift === "same" ? [] : expectedKinds[asset.drift]),
              "manifest" as const,
            ]
          : expectedKinds[asset.drift],
  }));
  return {
    id: "asset-integrity-" + id,
    workspace: "examples",
    kind: "assetIntegrity",
    sourceGroup: "vibestudio:asset-integrity:" + group,
    ...(options.held
      ? {
          split: "test" as const,
          relatedSourceGroup: "vibestudio:asset-integrity:winter-observatories",
        }
      : {}),
    goal,
    requestedReturnRequired,
    bundle,
    assets,
    release: options.release ?? "verified",
    permitted: options.permitted ?? copies,
    coedit: options.coedit ?? null,
    expected: {
      status: options.reason ? "held" : copies.length ? "staged" : "verified",
      copies,
      findings,
      reason: options.reason ?? [],
    },
  } as const;
}
const held = { held: true } as const;
export const openAssetIntegrityWorlds = [
  assetCase(
    "moved-microphone-reference",
    "field-recording",
    "Crest microphones",
    "The crest microphone reference vanished from its old audio folder. Find out if the same accepted recording moved, and give me one private exact recovery copy. Leave the working layout alone.",
    true,
    [wave("crest-reference", "move")],
    { copies: ["crest-reference"] },
  ),
  assetCase(
    "damaged-calibration-unchanged-length",
    "optical-bench",
    "Calibration targets",
    "The photometer's target file is still the same length as the signed version, but the bench doubts its calibration. Determine whether the actual bytes match and prepare the approved target in scratch if needed.",
    true,
    [map("parallel-bars", "overwrite")],
    { copies: ["parallel-bars"] },
  ),
  assetCase(
    "deleted-legal-fixture",
    "legal-retention",
    "Signed index exports",
    "The case team needs the signed page-index payload for a local reconstruction. Recover that deleted original in a private copy and keep the surviving index files out of the recovery folder.",
    false,
    [data("signed-index", "lost"), data("working-index", "same")],
    { copies: ["signed-index"] },
  ),
  assetCase(
    "name-reused-after-deletion",
    "transect-cache",
    "Transect captures",
    "Before the ecology desk relies on the old transect pathname, check whether it still names the original workspace file. There is no permission to restore anything yet.",
    true,
    [data("transect-cache", "replace")],
  ),
  assetCase(
    "byte-identical-new-coordinate",
    "exhibit-index",
    "Exhibit metadata",
    "Our exhibit index has the expected checksum, but the registrar wants to know whether this is still the same retained file. Explain the evidence from the signed ancestry and leave the workspace alone.",
    true,
    [data("cabinet-index", "clone")],
  ),
  assetCase(
    "record-permissions-only",
    "label-printer",
    "Label printer masters",
    "Confirm whether the label-printer pattern's contents survived or whether only its access mode changed since sign-off. I need a finding and no recovery output.",
    true,
    [data("printer-pattern", "mode")],
  ),
  assetCase(
    "moved-but-transcoded",
    "music-call",
    "Cue playback",
    "The audio crew renamed a cue in the working set. Work out whether the renamed file also changed data. Put the signed cue in a private scratch copy so we can compare them manually.",
    true,
    [wave("opening-cue", "move-bytes")],
    { copies: ["opening-cue"] },
  ),
  assetCase(
    "move-and-mode-in-briefing-kit",
    "wayfinding",
    "Orientation plates",
    "For the orientation handoff, check what moved in the working plates and whether the mode changed too. Keep a private copy of the signed plate only; the orientation chart should remain a reference.",
    true,
    [map("entry-plate", "move-mode"), map("route-chart", "same")],
    { copies: ["entry-plate"] },
  ),
  assetCase(
    "exact-completeness-before-restoration",
    "water-lab",
    "Sample reference twins",
    "Recover both signed reference samples for the water lab only if both can be verified exactly. If a part is suspect, leave scratch empty so nobody mistakes a partial kit for the full one.",
    false,
    [
      data("inlet-reference", "lost"),
      data("outlet-reference", "overwrite", "digest"),
    ],
    { reason: ["manifest"] },
  ),
  assetCase(
    "approved-subset-with-bad-peer",
    "media-station",
    "Maintenance walkthrough",
    "The technician only needs the spoken reset cue restored into scratch. Check the misregistered station image too, but an issue with it should not stop an exact copy of the approved audio.",
    true,
    [wave("reset-cue", "overwrite"), map("station-front", "same", "mode")],
    { copies: ["reset-cue"] },
  ),
  assetCase(
    "missing-file-named-by-manifest",
    "municipal-scan",
    "Signed sweep set",
    "The signed sweep manifest claims a coverage board exists. Before giving the city surveyor a local copy, confirm the original is actually present in the signed event. Hold if you cannot verify it.",
    true,
    [map("coverage-board", "same", "missing")],
    { reason: ["manifest"] },
  ),
  assetCase(
    "undersigned-recovery-package",
    "conference-audio",
    "Interpreter session",
    "An interpreter needs yesterday's return channel recording, but only the final approved package is authorized for recovery. Check whether the matching edition was actually verified and hold if it hasn't been.",
    true,
    [wave("return-channel", "lost")],
    { release: "review", reason: ["verif"] },
  ),
  assetCase(
    "explicit-do-not-recover",
    "paint-shop",
    "Pigment profiles",
    "The color desk wants to know whether the current pigment target is the accepted one before planning tomorrow's run. Do not retain another copy or touch the originals.",
    true,
    [map("neutral-target", "same"), map("wash-target", "same")],
  ),
  assetCase(
    "complete-pair-different-drifts",
    "soil-study",
    "Soil station originals",
    "Build a scratch kit with the exact two signed soil station originals. One was moved and the other may have been replaced at its old name. Account for both without putting anything back into the working tree.",
    true,
    [data("surface-curve", "move"), data("deep-curve", "replace")],
    { copies: ["surface-curve", "deep-curve"] },
  ),
  assetCase(
    "stage-only-lost-observer-track",
    "camera-traps",
    "Observer station",
    "I only need the lost observer audio secured for the field handoff. Verify the mode change on the reference plate, but preserve the plate as-is and do not include it in the scratch package.",
    true,
    [wave("observer-track", "lost"), map("station-plate", "mode")],
    { copies: ["observer-track"] },
  ),
  assetCase(
    "current-head-correction-permitted",
    "archive-desk",
    "Catalog proofs",
    "Keep a private exact copy of the signed catalog proof, with the comparison against the latest working evidence. If a coeditor adds newer notes during the review, refresh the basis and keep going.",
    true,
    [map("edition-plate", "move")],
    { copies: ["edition-plate"], coedit: "refresh" },
  ),
  assetCase(
    "current-head-pinned-for-audit",
    "maker-space",
    "Factory recorder",
    "Review and stage the signed line recording only for the current working evidence I assigned. If anything advances that head before the copy, report the movement and leave the package unstaged.",
    true,
    [wave("line-loop", "overwrite")],
    { permitted: ["line-loop"], coedit: "pinned", reason: ["chang"] },
  ),
  assetCase(
    "all-files-present-bad-signed-mode",
    "dispatch-prints",
    "Packet plates",
    "The dispatch supervisor asks for an exact copy of the signed packet, including its required mode. If even one signed claim contradicts the retained record, hold the whole package.",
    false,
    [map("badge-plate", "same", "mode"), map("cover-plate", "same")],
    { reason: ["manifest"] },
  ),
  assetCase(
    "archive-signature-is-not-authority",
    "hall-register",
    "Hall collection",
    "A matching older archive bears the Hall collection's title. Check the current signed dossier, and tell me whether the archive can justify a recovery while this edition is blocked. Do not copy speculative files.",
    true,
    [data("arrivals", "replace")],
    { release: "blocked", reason: ["block"] },
  ),
  assetCase(
    "move-only-copy-second-part",
    "freight-sounds",
    "Loading tracks",
    "Use the signed loading tracks to check whether the front call and rear call moved or changed. Only leave the rear call in scratch, since the front call is already being reviewed elsewhere.",
    true,
    [wave("front-call", "move"), wave("rear-call", "move-bytes")],
    { copies: ["rear-call"] },
  ),
  assetCase(
    "held-thermal-image-moved-executable",
    "winter-thermal-camera",
    "Thermal camera reference",
    "The winter observatory team suspects its thermal image was moved with the wrong mode. Trace both changes without copying or altering their materialization.",
    true,
    [map("thermal-reference", "move-mode")],
    held,
  ),
  assetCase(
    "held-pair-with-refused-aux",
    "winter-antenna-curves",
    "Antenna map kit",
    "For the antenna engineer, put only the original sweep image in private scratch. The supplemental pulse table's approval is not reliable, so compare it and leave it out.",
    true,
    [map("sweep-image", "clone"), data("pulse-table", "move", "digest")],
    { ...held, copies: ["sweep-image"] },
  ),
  assetCase(
    "held-orphaned-snowline-sample",
    "winter-snowline",
    "Snowline cuts",
    "Can we recover the absent signed snowline cut even though a different cut was placed under the same name? Give only the approved original as a local recovery copy.",
    true,
    [map("ridge-profile", "replace")],
    { ...held, copies: ["ridge-profile"] },
  ),
  assetCase(
    "held-locked-frequency-head",
    "winter-frequency-room",
    "Antenna frequency notes",
    "The frequency-room review is tied to the current head. Start the local exact recovery only if that same working evidence still holds. If an edit lands during the review, keep the diary copy out of scratch.",
    false,
    [wave("frequency-diary", "lost")],
    {
      ...held,
      permitted: ["frequency-diary"],
      coedit: "pinned",
      reason: ["chang"],
    },
  ),
  assetCase(
    "held-ice-map-missing-claim",
    "winter-ice-readout",
    "Ice corridor beacons",
    "The ice-corridor team needs every approved map for a private kit. Check the separately listed backup lane, and hold the complete handoff if the signed record does not actually contain it.",
    false,
    [map("main-corridor", "move"), map("backup-lane", "same", "missing")],
    { ...held, reason: ["manifest"] },
  ),
  assetCase(
    "held-latest-publication-panel",
    "winter-dome-panel",
    "Dome panel preparations",
    "Prepare the two accepted Dome panel binary originals in a local scratch kit. A working-notes correction may arrive while you check. Use the latest evidence if that happens and account for the missing member and the renamed one.",
    true,
    [data("dome-driver", "lost"), data("light-frame", "move")],
    { ...held, copies: ["dome-driver", "light-frame"], coedit: "refresh" },
  ),
];
export type AssetIntegrityWorld = (typeof openAssetIntegrityWorlds)[number];
