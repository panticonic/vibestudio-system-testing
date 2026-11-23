import { requireAssignedWorld } from "./assigned-world.js";
import { isDeepStrictEqual } from "node:util";
import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import type { PanelTeacherResult } from "@vibestudio/service-schemas/systemTestRunner";
import { tourRehearsalWorlds } from "./tour-rehearsal-worlds.js";

export type TourRehearsalInput = { contextId: string; caseId: string; panelId: string };
type Frame = {
  storedScene: string;
  storedNotes: boolean;
  eyebrow: string;
  heading: string;
  progress: string;
  notesVisible: boolean;
};
type Scene = { id: string; title: string; position: number; eyebrow: string };
type Start = { deck: Scene[]; allowed: string[]; frame: Frame };
type Stop = { topic: string; scene: Scene; notes: boolean };
type Readback = { stage: string; frame: Frame };
type Report = {
  start: Start;
  plan: { stops: Stop[]; unmatchedTopics: string[] };
  visits: { stop: Stop; readback: Readback }[];
  restoration: Readback | null;
  outcome: string;
};
type Services = {
  tourRehearsal: {
    observe(id: string): Promise<Start>;
    visit(id: string, scene: string, notes: boolean): Promise<Frame>;
    restore(id: string): Promise<Frame>;
  };
};
type Binding = {
  request: { operationId: string; goal: string; topics: string[]; restore: boolean };
  services: Services;
};

export function prepareTourRehearsal(input: TourRehearsalInput, binding: Binding) {
  const world = requireAssignedWorld(tourRehearsalWorlds, input.caseId, "Unknown assigned rehearsal");
  const unmatched = "unmatched" in world ? [...world.unmatched] : [];
  const shouldVisit = unmatched.length === 0;
  const { request } = binding;
  let start: Start | undefined;
  let restored: Frame | undefined;
  let reads = 0;
  let restorations = 0;
  const visited: { scene: string; notes: boolean; frame: Frame }[] = [];
  const services: Services = {
    tourRehearsal: {
      async observe(id) {
        const result = await binding.services.tourRehearsal.observe(id);
        start = structuredClone(result);
        reads++;
        return result;
      },
      async visit(id, scene, notes) {
        const result = await binding.services.tourRehearsal.visit(id, scene, notes);
        visited.push({ scene, notes, frame: structuredClone(result) });
        return result;
      },
      async restore(id) {
        const result = await binding.services.tourRehearsal.restore(id);
        restored = structuredClone(result);
        restorations++;
        return result;
      },
    },
  };

  function stops(opening: Start): Stop[] {
    return world.expected.map(({ scene }, i) => {
      const match = opening.deck.find(({ id }) => id === scene);
      if (!match) throw new Error("The tour registry lacked the assigned scene");
      return { topic: world.topics[i]!, scene: match, notes: world.notes };
    });
  }

  function isFrame(frame: Frame, scene: string, notes: boolean, progress: string) {
    const meta = start?.deck.find(({ id }) => id === scene);
    return !!meta && frame.storedScene === scene && frame.storedNotes === notes &&
      frame.notesVisible === notes && frame.eyebrow === meta.eyebrow &&
      frame.progress === progress && frame.heading.length > 0;
  }

  function verify(report: Report | null) {
    const assigned = start ? stops(start) : [];
    const checks = {
      initial: reads >= 1 && !!start && isDeepStrictEqual(start.allowed, world.allowed) &&
        isFrame(start.frame, world.initial.scene, world.initial.notes, world.initial.progress) &&
        isDeepStrictEqual(report?.start, start),
      plan: isDeepStrictEqual(report?.plan, { stops: assigned, unmatchedTopics: unmatched }),
      visits: visited.length === (shouldVisit ? assigned.length : 0) &&
        visited.every(({ scene, notes, frame }, i) => scene === world.expected[i]?.scene &&
          notes === world.notes && isFrame(frame, scene, notes, world.expected[i]!.progress)) &&
        isDeepStrictEqual(report?.visits, visited.map(({ frame }, i) => ({
          stop: assigned[i], readback: { stage: "verified", frame },
        }))),
      restoration: world.restore
        ? restorations === 1 && !!restored && isDeepStrictEqual(restored, start?.frame) &&
          isDeepStrictEqual(report?.restoration, { frame: restored, stage: "verified" })
        : restorations === 0 && report?.restoration === null,
      outcome: report?.outcome === (shouldVisit ? "rehearsed" : "held"),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      ...input,
      request,
      start,
      visited,
      restored,
      checks,
    };
  }
  async function qualify() {
    const initial = await services.tourRehearsal.observe(request.operationId);
    const assigned = stops(initial);
    const visits: Report["visits"] = [];
    if (shouldVisit) {
      for (const stop of assigned) {
        const frame = await services.tourRehearsal.visit(request.operationId, stop.scene.id, stop.notes);
        visits.push({ stop, readback: { stage: "verified", frame } });
      }
    }
    const restoration = world.restore
      ? { stage: "verified", frame: await services.tourRehearsal.restore(request.operationId) }
      : null;
    return verify({
      start: initial, plan: { stops: assigned, unmatchedTopics: unmatched }, visits, restoration,
      outcome: shouldVisit ? "rehearsed" : "held",
    });
  }
  return { request, services, qualify, verify };
}

type Prepared = ReturnType<typeof prepareTourRehearsal>;
export interface TourRehearsalReceiver {
  runTourRehearsalTeacher(input: TourRehearsalInput & { executorModel: string }): Promise<{
    contextId: string;
    teacher: PanelTeacherResult;
    verification: ReturnType<Prepared["verify"]>;
  }>;
  qualifyTourRehearsal(input: TourRehearsalInput): ReturnType<Prepared["qualify"]>;
}
export const tourRehearsalMethods = createReceiverRpcMethods<TourRehearsalReceiver>([
  "runTourRehearsalTeacher", "qualifyTourRehearsal",
]);
