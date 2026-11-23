import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { createTestDO } from "@vibestudio/durable/test-utils";
import { openNotificationStateWorlds } from "../../skills/system-testing/open-goal-notification-state-worlds.js";
import { prepareOpenNotificationState } from "../../skills/system-testing/open-goal-notification-state-managed.js";
import { NotificationStateFixtureDO } from "./index.js";

describe("open durable notification lifecycle", () => {
  for (const world of openNotificationStateWorlds) {
    it(world.id, async () => {
      const contextId = `fixture-${world.id}`;
      const id = "owned-test-actor";
      const targetId = "owned-test-target";
      let retired = false;
      let store:
        | Awaited<
            ReturnType<typeof createTestDO<typeof NotificationStateFixtureDO>>
          >
        | undefined;
      const runtime = {
        async createEntity(input: { key: string; contextId: string }) {
          expect(input.contextId).toBe(contextId);
          store = await createTestDO(NotificationStateFixtureDO, {
            __objectKey: input.key,
            WORKER_SOURCE: "workers/notification-state-fixture",
            WORKER_CLASS_NAME: "NotificationStateFixtureDO",
          });
          return { id, targetId, kind: "do", contextId };
        },
        async retireEntity(input: { id: string }) {
          expect(input.id).toBe(id);
          retired = true;
        },
      };
      const rpc = {
        async call(
          destination: string,
          method: string | { name: string },
          args: unknown[],
        ) {
          expect(destination).toBe(targetId);
          expect(retired).toBe(false);
          const name = typeof method === "string" ? method : method.name;
          const result=await store!.call(name,...args);
          if(name==="refresh"){
            // The first native commit succeeded but its caller lost the response.
            expect(await store!.call(name,...args)).toEqual(result);
            expect((await store!.call("audit")).refreshCommits).toBe(1);
          }
          return result;
        },
      };
      const prepared = await prepareOpenNotificationState(
        { contextId, caseId: world.id },
        world,
        { contextId, runtime, rpc } as unknown as Parameters<
          typeof prepareOpenNotificationState
        >[2],
      );
      try {
        const verification = await prepared.qualify();
        expect(verification.checks).toEqual(
          Object.fromEntries(
            Object.keys(verification.checks).map((key) => [key, true]),
          ),
        );
        expect(verification.passed).toBe(true);
        if (process.env.VIBE_NOTIFICATION_PROOFS)
          await fs.writeFile(
            path.join(process.env.VIBE_NOTIFICATION_PROOFS, world.id + ".json"),
            JSON.stringify(verification),
          );
      } finally {
        try {
          await prepared.close();
        } finally {
          store?.db.close();
        }
      }
      expect(retired).toBe(true);
    });
  }
});

it("withholds a real old revision and lets a second exact acknowledgment preserve its receipt", async () => {
  const store = await createTestDO(NotificationStateFixtureDO, {
    __objectKey: "notification-state-revision-check",
    WORKER_SOURCE: "workers/notification-state-fixture",
    WORKER_CLASS_NAME: "NotificationStateFixtureDO",
  });
  try {
    const initial = {
      id: "approval",
      title: "Approve original request",
      revision: 1,
    };
    const { assigned } = await store.call("configure", {
      desk: "Owned Review",
      initial: [initial],
      change: {
        put: {
          ...initial,
          title: "Corrected request needs approval",
          revision: 2,
        },
      },
      transition: "rotate",
    });
    const { lane } = await store.call("refresh", assigned);
    expect(lane).not.toBeNull();
    expect(await store.call("read", assigned)).toBeNull();
    expect(
      await store.call("acknowledge", assigned, "approval", 2),
    ).toMatchObject({ status: "unavailable" });
    expect(await store.call("acknowledge", lane!, "approval", 1)).toMatchObject(
      { status: "stale" },
    );
    expect((await store.call("audit")).rows[0]).toMatchObject({
      revision: 2,
      acknowledgedAt: null,
    });
    expect(await store.call("acknowledge", lane!, "approval", 2)).toMatchObject(
      { status: "acknowledged" },
    );
    expect(await store.call("acknowledge", lane!, "approval", 2)).toMatchObject(
      { status: "already-read" },
    );
    expect((await store.call("audit")).rows[0]).toMatchObject({
      revision: 2,
      acknowledgedAt: 10_000,
    });
  } finally {
    store.db.close();
  }
});

it("replays only the exact committed notification observation, preserving one native transition",async()=>{
 const store=await createTestDO(NotificationStateFixtureDO,{__objectKey:"notification-state-replay",WORKER_SOURCE:"workers/notification-state-fixture",WORKER_CLASS_NAME:"NotificationStateFixtureDO"});
 try{
  const {assigned,neighbor}=await store.call("configure",{desk:"Owned",initial:[{id:"same",title:"Same",revision:1}],change:{put:{id:"same",title:"Same",revision:1}},transition:"rotate"});
  const first=await store.call("refresh",assigned);
  expect(await store.call("refresh",assigned)).toEqual(first);
  expect((await store.call("audit")).refreshCommits).toBe(1);
  await expect(store.call("refresh",neighbor)).rejects.toThrow(/another exact observation/);
  await expect(store.call("refresh",{...assigned,generation:3})).rejects.toThrow(/another exact observation/);
  await expect(store.call("refresh",{...assigned,label:"Foreign"})).rejects.toThrow(/another exact observation/);
 }finally{store.db.close();}
});
