import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { WEB_READ_MAX_LIMIT, type WebReadInput, type WebReadResult } from "@workspace/web-core/contract";

type Read = (input: WebReadInput) => Promise<WebReadResult>;
type CachedPage = { digest: string; size: number; head: string; headBytes: number };
const utf8 = new TextEncoder();

export async function readCachedWebRange(read: Read, digest: string, start: number, end: number) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new Error("The cached web range has an invalid byte extent");
  }
  let offset = start;
  let text = "";
  while (offset < end) {
    const limit = Math.min(WEB_READ_MAX_LIMIT, end - offset);
    const range = await read({ digest, offset, limit });
    if (range.digest !== digest || range.offset !== offset || !Number.isSafeInteger(range.bytes) ||
        range.bytes <= 0 || range.bytes > limit || range.nextOffset !== offset + range.bytes ||
        utf8.encode(range.text).byteLength !== range.bytes) {
      throw new Error("Cached web readback did not return the next exact byte range");
    }
    text += range.text;
    offset = range.nextOffset;
  }
  return text;
}

export async function readVerifiedCachedPage(read: Read, page: CachedPage) {
  const text = await readCachedWebRange(read, page.digest, 0, page.size);
  return { text, exact: text.startsWith(page.head) && utf8.encode(page.head).byteLength === page.headBytes &&
    sha256HexSyncText(text) === page.digest };
}
