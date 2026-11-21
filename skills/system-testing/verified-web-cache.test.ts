import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createWebPages, type WebRpcCaller } from "@workspace/web-core";
import { readCachedWebRange, readVerifiedCachedPage } from "./verified-web-cache.js";

const digestOf = (text: string) => createHash("sha256").update(text).digest("hex");

it("reconstructs a long native cached page across its UTF-8 boundary and verifies exact hash and head", async () => {
  const text = "a".repeat(31999) + "é" + "b".repeat(18100) + "\nExact authoritative evidence.";
  const body = Buffer.from(text);
  const digest = digestOf(text);
  const reads: Array<[number, number]> = [];
  const call = vi.fn(async (target: string, method: { name: string }, args: [string, number, number]) => {
    expect(target).toBe("main");
    expect(method.name).toBe("blobstore.getRangeBytes");
    const [requestedDigest, offset, limit] = args;
    expect(requestedDigest).toBe(digest);
    expect(limit).toBeLessThanOrEqual(32000);
    reads.push([offset, limit]);
    return { bytesBase64: body.subarray(offset, offset + limit).toString("base64") };
  });
  const pages = createWebPages({ rpc: { call: call as unknown as WebRpcCaller } });
  const page = { digest, size: body.length, head: text.slice(0, 128), headBytes: 128 };
  expect(await readVerifiedCachedPage(pages.read, page)).toEqual({ text, exact: true });
  expect(reads).toEqual([[0, 32000], [31999, body.length - 31999]]);
});

it("rejects wrong ranges and flags the wrong head or whole-page digest", async () => {
  const text = "current page";
  const size = Buffer.byteLength(text);
  const digest = digestOf(text);
  const read = ({ digest, offset, limit }: { digest: string; offset?: number; limit?: number }) =>
    Promise.resolve({ digest, offset: offset ?? 0, limit: limit ?? size, bytes: size, nextOffset: size, text });
  await expect(readCachedWebRange(async input => ({ ...await read(input), bytes: 0 }), digest, 0, size))
    .rejects.toThrow(/next exact byte range/);
  await expect(readCachedWebRange(async input => ({ ...await read(input), digest: "wrong" }), digest, 0, size))
    .rejects.toThrow(/next exact byte range/);
  expect((await readVerifiedCachedPage(read, { digest, size, head: "different", headBytes: 9 })).exact).toBe(false);
  expect((await readVerifiedCachedPage(read, { digest: "0".repeat(64), size, head: text, headBytes: size })).exact).toBe(false);
});
