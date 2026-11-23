import { expect, it } from "vitest";
import { prepareManagedProvenanceHistory } from "./provenance-history-managed.js";
const ports = {
  status: async () => ({
    clean: true,
    workingHead: { kind: "event", eventId: "head" },
  }),
  resolveRepository: async () => ({ repositoryId: "owned" }),
  readFile: async () => null,
  walk: async () => {
    throw Error("An absent file has no walk");
  },
};
it("allows assigned immutable VCS reads in any order and repeats without changing evidence identifiers", async () => {
  const fixture = await prepareManagedProvenanceHistory(
    ports as never,
    "owned",
    "packages/owned",
    "missing-ingress",
  );
  const [first, second] = fixture.request.checks;
  const secondRead = await fixture.service.readNext(second!);
  await fixture.service.readNext(first!);
  expect(await fixture.service.readNext(second!)).toEqual(secondRead);
  expect((await fixture.verify(fixture.reference())).passed).toBe(true);
  await expect(
    fixture.service.readNext({ ...first!, path: "foreign" }),
  ).rejects.toThrow("assigned VCS walk");
});
it("retains read order when the user explicitly asks for a sequence", async () => {
  const fixture = await prepareManagedProvenanceHistory(
    ports as never,
    "owned",
    "packages/owned",
    "visible-change-chain",
  );
  await expect(
    fixture.service.readNext(fixture.request.checks[1]!),
  ).rejects.toThrow("assigned VCS walk");
});
