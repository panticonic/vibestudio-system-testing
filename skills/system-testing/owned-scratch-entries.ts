import type { RuntimeFs } from "@workspace/runtime";

/** A fresh owned context may have no scratch directory until its first write. */
export async function listOwnedScratchEntries(
  fs: Pick<RuntimeFs, "readdir">,
): Promise<string[]> {
  try {
    return await fs.readdir("/.tmp");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}
