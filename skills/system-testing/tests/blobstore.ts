import {
  NativeBlobTextObservationSchema,
  NativeBlobTreeObservationSchema,
  type NativeBlobTreeObservation,
  type NativeBlobTextObservation,
} from "@vibestudio/service-schemas/blobstore";
import type { TestCase } from "../types.js";
import {
  findLastAgentMessage,
  getToolCalls,
  noIncompleteInvocations,
  successfulEvalCode,
  successfulEvalReturnValues,
} from "./_helpers.js";
import { walkRecords } from "./_scenario-evidence.js";

function hasNamedTrue(values: unknown[], pattern: RegExp): boolean {
  return values.some((value) =>
    walkRecords([value]).some((item) =>
      Object.entries(item).some(([key, child]) => pattern.test(key) && child === true)
    )
  );
}

function hasDigest(values: unknown[]): boolean {
  return values.some((value) =>
    walkRecords([value]).some((item) =>
      Object.entries(item).some(
        ([key, child]) =>
          /digest|hash/iu.test(key) && typeof child === "string" && /^[0-9a-f]{64}$/u.test(child)
      )
    )
  );
}

function checked(
  result: Parameters<typeof noIncompleteInvocations>[0],
  methods: RegExp[],
  finalClaims: RegExp[],
  resultProof: (values: unknown[]) => boolean
) {
  const code = successfulEvalCode(result);
  if (!methods.every((method) => method.test(code))) {
    return {
      passed: false,
      reason: "Canonical eval arguments omitted a required blobstore operation",
    };
  }
  const values = successfulEvalReturnValues(result);
  if (values.length === 0 || !resultProof(values)) {
    return {
      passed: false,
      reason: "Canonical eval results omitted the blobstore verification proof",
    };
  }
  const final = findLastAgentMessage(result);
  if (!finalClaims.every((claim) => claim.test(final))) {
    return {
      passed: false,
      reason: "Final response did not semantically report the blobstore round trip",
    };
  }
  const pending = noIncompleteInvocations(result);
  return pending;
}

function nativeBlobEntries(result: Parameters<typeof noIncompleteInvocations>[0]) {
  return getToolCalls(result).flatMap((call) => {
    if (call.name !== "eval" || call.execution?.status !== "complete" || call.execution.isError)
      return [];
    const payload = call.execution.result as
      | {
          details?: {
            operationJournal?: {
              protocol?: string;
              truncated?: boolean;
              entries?: unknown[];
            };
          };
        }
      | undefined;
    const journal = payload?.details?.operationJournal;
    if (
      journal?.protocol !== "workspace-operations.v1" ||
      journal.truncated !== false ||
      !Array.isArray(journal.entries)
    )
      return [];
    return journal.entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      return [value];
    });
  });
}

function textRoundTripChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const observations: NativeBlobTextObservation[] = nativeBlobEntries(result).flatMap((entry) => {
    if (entry["type"] !== "blob-text.observation") return [];
    const parsed = NativeBlobTextObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
  const verified = observations.some(
    (stored) =>
      stored.method === "putText" &&
      stored.size > 0 &&
      stored.lineCount > 1 &&
      stored.digest === stored.contentDigest &&
      observations.some(
        (read) =>
          read.method === "getText" &&
          read.digest === stored.digest &&
          read.contentDigest === stored.digest &&
          read.size === stored.size
      ) &&
      observations.some(
        (range) =>
          range.method === "getRange" &&
          range.digest === stored.digest &&
          range.present &&
          range.decodedSize !== null &&
          range.decodedSize > 0 &&
          range.length < stored.size &&
          range.offset + range.length <= stored.size
      ) &&
      observations.some(
        (search) =>
          search.method === "grep" &&
          search.digest === stored.digest &&
          search.matchCount !== null &&
          search.matchCount > 0 &&
          search.matchCount <= search.maxMatches
      )
  );
  if (!verified)
    return {
      passed: false,
      reason:
        "Native blob observations did not join a stored multi-line document to its exact full read, smaller range and successful search",
    };
  const final = findLastAgentMessage(result);
  if (
    ![/text|document/iu, /\b(?:range|slice|bytes?)\b/iu, /search|grep|marker|match/iu].every((claim) =>
      claim.test(final)
    )
  )
    return {
      passed: false,
      reason: "Final response did not report the document, range and search results",
    };
  return noIncompleteInvocations(result);
}

function treeLifecycleChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const entries = nativeBlobEntries(result);
  const trees: NativeBlobTreeObservation[] = entries.flatMap((entry) => {
    if (entry["type"] !== "blob-tree.observation") return [];
    const parsed = NativeBlobTreeObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
  const reads: NativeBlobTextObservation[] = entries.flatMap((entry) => {
    if (entry["type"] !== "blob-text.observation") return [];
    const parsed = NativeBlobTextObservationSchema.safeParse(entry["receipt"]);
    return parsed.success ? [parsed.data] : [];
  });
  const created = new Set(
    trees.flatMap((tree) =>
      tree.method === "putTree" ? [tree.treeHash, ...(tree.stateHash ? [tree.stateHash] : [])] : []
    )
  );
  const verified = trees.some((listing) => {
    if (
      listing.method !== "listTree" ||
      !listing.page ||
      listing.page.completeness !== "complete" ||
      listing.page.basis.ref !== listing.ref ||
      !created.has(listing.ref)
    )
      return false;
    const files = listing.page.entries.filter((entry) => entry.kind === "file");
    return (
      files.length > 0 &&
      files.some((file) =>
        reads.some(
          (read) =>
            read.method === "getText" &&
            read.digest === file.contentHash &&
            read.contentDigest === file.contentHash &&
            read.size !== null
        )
      ) &&
      trees.some(
        (diff) =>
          diff.method === "diffTrees" &&
          diff.from === listing.ref &&
          diff.to !== diff.from &&
          created.has(diff.to) &&
          diff.diff.changed.length === 1 &&
          diff.diff.added.length === 0 &&
          diff.diff.removed.length === 0 &&
          trees.some(
            (materialized) =>
              materialized.method === "materializeTree" &&
              (materialized.ref === diff.from || materialized.ref === diff.to) &&
              materialized.written + materialized.unchanged >= files.length
          )
      )
    );
  });
  if (!verified)
    return {
      passed: false,
      reason:
        "Native blob facts did not join created tree versions, a complete listing and exact file read, a changed-file diff and completed materialization",
    };
  const final = findLastAgentMessage(result);
  if (
    ![/tree/iu, /difference|changed|diff/iu, /materializ/iu, /files?/iu].every((claim) =>
      claim.test(final)
    )
  )
    return {
      passed: false,
      reason: "Final response did not report the tree difference and materialized files",
    };
  return noIncompleteInvocations(result);
}

export const blobstoreTests: TestCase[] = [
  {
    name: "blob-text-roundtrip-grep",
    description: "Store text content-addressably, read a range back, and grep it",
    category: "blobstore",
    prompt:
      "Put a short multi-line document with a distinctive marker line into the workspace's content-addressable storage. Verify the full text, read back a smaller byte range, and search the stored content for that marker without scanning the whole value yourself.",
    validate: textRoundTripChecked,
  },
  {
    name: "blob-binary-roundtrip",
    description: "Store binary data in the blob store and verify the bytes round-trip",
    category: "blobstore",
    prompt:
      "Store a small binary value in the workspace's content-addressable storage and verify that the bytes returned are exactly the bytes you supplied. Report the size you checked.",
    validate: (result) =>
      checked(
        result,
        [
          /blobstore\.putBytes|blobstore\.putBase64/iu,
          /blobstore\.getBytes|blobstore\.getBase64/iu,
        ],
        [/binary|bytes/iu, /\d/u, /match|same|exact|round.trip/iu],
        (values) =>
          hasDigest(values) &&
          hasNamedTrue(values, /equal|same|exact|match|round.?trip/iu) &&
          values.some((value) =>
            walkRecords([value]).some((item) =>
              Object.entries(item).some(
                ([key, child]) =>
                  /size|length|bytes/iu.test(key) && Number.isInteger(child) && Number(child) > 0
              )
            )
          )
      ),
  },
  {
    name: "blob-tree-lifecycle",
    description: "Build, list, diff, and materialize an immutable blob file tree",
    category: "blobstore",
    prompt:
      "Build a small immutable file tree from a few files, inspect and read it, create a second version with one changed file, and explain the resulting tree difference. Materialize one version into the sandbox and confirm the expected files arrived.",
    validate: treeLifecycleChecked,
  },
];
