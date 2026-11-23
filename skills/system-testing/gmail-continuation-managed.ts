import { isDeepStrictEqual } from "node:util";
import type { prepareGmailComposeHistory } from "./gmail-compose-history-managed.js";
import {
  gmailContinuationWork,
  type GmailContinuationAction,
} from "./google-setup-worlds.js";

type Setup<Report> = {
  request: { goal: string };
  services: {
    googleWorkspaceRead: { readiness(): Promise<unknown> };
    googleSetupPanel: { observe(): Promise<unknown> };
  };
  reference(): Report;
  verify(report: Report | null): {
    passed: boolean;
    checks: { driveNeedsSetup: boolean; browserAgrees: boolean };
    receipts: { id: string; check: { kind: string }; gmailEnabled: boolean }[];
  };
};
type Compose = ReturnType<typeof prepareGmailComposeHistory>;

export function prepareGmailContinuation<SetupReport>(
  setup: Setup<SetupReport>,
  compose: Compose,
  action: GmailContinuationAction,
) {
  let served: { evidenceId: string; enabled: boolean } | undefined;
  async function launchEvidence() {
    const readback = setup.verify(null);
    const gate = [...readback.receipts].reverse().find(
      ({ check }) => check.kind === "launch-gate",
    );
    if (
      !readback.checks.driveNeedsSetup ||
      !readback.checks.browserAgrees ||
      !gate
    )
      throw new Error(
        "Read the assigned Gmail launch control after setup observation",
      );
    served = { evidenceId: gate.id, enabled: gate.gmailEnabled };
    return { ...served };
  }
  function expected(audit: Awaited<ReturnType<Compose["reference"]>>) {
    return {
      action,
      launch: "held",
      evidenceIds: [
        served?.evidenceId,
        audit.history.receipt.events.at(-1)?.id,
      ],
    };
  }
  function verify(value: unknown) {
    const report = value as { results?: { report: unknown }[] } | null;
    const setupReport = (report?.results?.[0]?.report ??
      null) as SetupReport | null;
    const continuation = report?.results?.[1]?.report as {
      audit: Awaited<ReturnType<Compose["reference"]>>;
      continuation: unknown;
    } | null;
    const setupReadback = setup.verify(setupReport);
    const composeReadback = compose.verify(continuation?.audit ?? null);
    const checks = {
      verifiedSetup: setupReadback.passed,
      verifiedCompose: composeReadback.passed,
      boundContinuation:
        served?.enabled === false &&
        !!continuation?.audit &&
        composeReadback.passed &&
        isDeepStrictEqual(
          continuation.continuation,
          expected(continuation.audit),
        ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      checks,
      setup: setupReadback,
      compose: composeReadback,
      gate: served,
    };
  }
  return {
    request: {
      goal:
        setup.request.goal +
        " Complete the setup observation before planning the compose continuation.",
      work: [
        { ...gmailContinuationWork[0], input: setup.request },
        { ...gmailContinuationWork[1], input: compose.request },
      ],
    },
    services: {
      ...setup.services,
      ...compose.services,
      gmailContinuationRead: { launchEvidence },
    },
    verify,
    async qualify() {
      const early = await launchEvidence().then(
        () => false,
        () => true,
      );
      await setup.services.googleWorkspaceRead.readiness();
      await setup.services.googleSetupPanel.observe();
      await launchEvidence();
      const audit = await compose.reference();
      const continuation = expected(audit);
      const report = {
        results: [
          { report: setup.reference() },
          { report: { audit, continuation } },
        ],
      };
      const verification = verify(report);
      const altered = {
        ...continuation,
        evidenceIds: ["wrong-control", "wrong-compose-event"],
      };
      return {
        verification,
        rejectedDifferentReceipt:
          early &&
          !verify({
            results: [
              report.results[0],
              { report: { audit, continuation: altered } },
            ],
          }).passed,
      };
    },
  };
}
