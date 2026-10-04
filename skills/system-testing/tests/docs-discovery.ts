import type { TestCase } from "../types.js";
import { findLastAgentMessage, getToolCalls, noIncompleteInvocations } from "./_helpers.js";
import { invocationReturnValue, walkArrays, walkRecords } from "./_scenario-evidence.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function details(value: unknown): unknown {
  return record(value)?.["details"] ?? value;
}

function concreteLabel(hit: Record<string, unknown>): string | null {
  for (const field of ["qualifiedName", "title", "id"] as const) {
    const value = hit[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function completed(result: Parameters<typeof noIncompleteInvocations>[0], name: string) {
  return getToolCalls(result).filter(
    (call) =>
      call.name === name && call.execution?.status === "complete" && call.execution.isError !== true
  );
}

function boundedSearches(result: Parameters<typeof noIncompleteInvocations>[0]) {
  return completed(result, "docs_search").filter((call) => {
    const limit = call.arguments?.["limit"];
    return (
      limit === undefined || (Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100)
    );
  });
}

function docsSearchChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const calls = boundedSearches(result);
  const hits = calls.flatMap((call) => {
    const value = details(call.execution?.result);
    return Array.isArray(value) ? value.filter((item) => record(item)) : [];
  }) as Record<string, unknown>[];
  const blobHits = hits.filter((hit) =>
    /blob|content.address/iu.test(`${hit["qualifiedName"] ?? ""} ${hit["description"] ?? ""}`)
  );
  if (blobHits.length === 0) {
    return {
      passed: false,
      reason: "Bounded docs search returned no canonical blobstore capability hit",
    };
  }
  const final = findLastAgentMessage(result);
  if (
    !/content.address|blob/iu.test(final) ||
    !blobHits.some((hit) => {
      const label = concreteLabel(hit);
      return label !== null && final.includes(label);
    })
  ) {
    return {
      passed: false,
      reason: "Final response did not cite an observed blobstore documentation hit",
    };
  }
  return noIncompleteInvocations(result);
}

function mentionsIdentifier(text: string, label: string, allowMember = false): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const suffix = allowMember ? "(?![\\p{L}\\p{N}_$])" : "(?![\\p{L}\\p{N}_$]|\\.[\\p{L}\\p{N}_$])";
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_$.])${escaped}${suffix}`, "iu").test(text);
}

function docsDescribeChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const hits = boundedSearches(result).flatMap((call) => {
    const value = details(call.execution?.result);
    return Array.isArray(value) ? value.filter((item) => record(item)) : [];
  }) as Record<string, unknown>[];
  const hitIds = new Set(
    hits.map((hit) => hit["id"]).filter((id): id is string => typeof id === "string")
  );
  const opened = completed(result, "docs_open").flatMap((call) => {
    const id = call.arguments?.["id"];
    const value = record(details(call.execution?.result));
    return typeof id === "string" && hitIds.has(id) && value?.["id"] === id ? [value] : [];
  });
  if (opened.length === 0) {
    return {
      passed: false,
      reason: "Docs open result was not identity-joined to a bounded search hit",
    };
  }
  const observations = opened.flatMap((entry) => {
    const label = concreteLabel(entry);
    if (!label) return [];
    const parent = entry["parent"];
    const service = typeof parent === "string" && parent.startsWith("service:")
      ? parent.slice("service:".length)
      : label;
    const members = Array.isArray(entry["members"]) ? entry["members"] : [label];
    const prefix = `${service}.`;
    return members.flatMap((member) =>
      typeof member === "string" && member.startsWith(prefix)
        ? [{ service, member, method: member.slice(prefix.length) }]
        : [],
    );
  });
  if (observations.length === 0) {
    return {
      passed: false,
      reason: "Opened service documentation exposed no canonical method identities",
    };
  }
  const final = findLastAgentMessage(result);
  if (!observations.some(({ service, member, method }) =>
    mentionsIdentifier(final, service, true) &&
    (mentionsIdentifier(final, member) || mentionsIdentifier(final, method)),
  )) {
    return {
      passed: false,
      reason: "Final response did not describe the opened service and an observed method",
    };
  }
  return noIncompleteInvocations(result);
}

function docsServicesChecked(result: Parameters<typeof noIncompleteInvocations>[0]) {
  const observations: Array<{ count: number; labels: string[] }> = [];
  const searchCalls = boundedSearches(result).filter(
    (call) => call.arguments?.["surface"] === "service"
  );
  for (const call of searchCalls) {
    const value = details(call.execution?.result);
    const hits = Array.isArray(value)
      ? value.flatMap((item) => (record(item) ? [record(item)!] : []))
      : [];
    const labels = hits.flatMap((hit) => (concreteLabel(hit) ? [concreteLabel(hit)!] : []));
    if (labels.length) observations.push({ count: hits.length, labels });
  }
  const serviceLabels = observations.flatMap(({ labels }) => labels);
  for (const call of completed(result, "eval")) {
    const code = String(call.arguments?.["code"] ?? "");
    if (
      /(?:docs\.listSurfaces\s*\(|rpc\.call\s*\(\s*["']main["']\s*,\s*["']docs\.listSurfaces["']\s*,)/u.test(
        code
      )
    ) {
      const returned = invocationReturnValue(call);
      if (returned.present && serviceLabels.length) {
        for (const row of walkRecords([returned.value])) {
          const count = row["count"];
          if (
            row["surface"] === "service" &&
            typeof count === "number" &&
            Number.isSafeInteger(count) &&
            count > 0
          ) {
            // Catalog entries include service parents and method entries; this
            // count is distinct from the registered-service enumeration.
            observations.push({ count, labels: serviceLabels });
          }
        }
      }
    }
    const enumeration =
      /(?:const|let)\s+(\w+)\s*=\s*await\s+(?:(?:services\.)?docs\.listServices\s*\(|rpc\.call\s*\(\s*["']main["']\s*,\s*["']docs\.listServices["']\s*,)/u.exec(
        code
      );
    if (!enumeration) continue;
    const listName = enumeration[1]!;
    // Join returned totals to the actual enumeration's length. Other catalog
    // counts (such as documentation entries by surface) are different facts.
    const countFields = Array.from(
      code.matchAll(new RegExp(`(\\w+)\\s*:\\s*${listName}\\.length\\b`, "gu")),
      (match) => match[1]!
    );
    const returned = invocationReturnValue(call);
    if (!returned.present) continue;
    for (const entries of walkArrays([returned.value])) {
      if (entries.length === 0 || entries.length > 100) continue;
      const labels = entries.flatMap((entry) => {
        const name = record(entry)?.["name"];
        return typeof name === "string" && name.length > 0 ? [name] : [];
      });
      if (labels.length !== entries.length) continue;
      // The API returns service descriptors. A bounded eval may return a
      // representative slice plus the observed total, instead of every row.
      const totals = walkRecords([returned.value])
        .filter((value) => Object.values(value).includes(entries))
        .flatMap((value) => countFields.map((field) => value[field]))
        .filter(
          (count): count is number =>
            typeof count === "number" && Number.isSafeInteger(count) && count >= labels.length
        );
      observations.push({ count: totals[0] ?? entries.length, labels });
    }
  }
  if (observations.length === 0)
    return { passed: false, reason: "No bounded live service-catalog observation was captured" };
  const final = findLastAgentMessage(result);
  const reported = observations.some(
    ({ count, labels }) =>
      new RegExp(`(?:^|\\D)${count}(?:\\D|$)`, "u").test(final) &&
      labels.some((label) => final.includes(label))
  );
  return reported
    ? noIncompleteInvocations(result)
    : {
        passed: false,
        reason:
          "Final response did not report an observed service count and representative service",
      };
}

export const docsDiscoveryTests: TestCase[] = [
  {
    name: "docs-search-capability",
    description: "Search the runtime documentation for a capability and cite hits",
    category: "docs-discovery",
    prompt:
      "Can this workspace store content-addressable blobs? Check the live runtime documentation rather than source files or guesses, and cite the relevant capability you find.",
    validate: docsSearchChecked,
  },
  {
    name: "docs-describe-service",
    description: "Describe one runtime service and its methods from the docs surface",
    category: "docs-discovery",
    prompt:
      "Choose one runtime service from the live documentation catalog and briefly explain what it does and some methods it actually exposes.",
    validate: docsDescribeChecked,
  },
  {
    name: "docs-list-services-bounded",
    description: "Enumerate available services in a bounded way",
    category: "docs-discovery",
    prompt:
      "Using the live documentation catalog, give me a bounded overview of the runtime's service surface: how many entries you observed and a few representative services.",
    validate: docsServicesChecked,
  },
];
