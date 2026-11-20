import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "@vibestudio/content-addressing";
import type { PublicationReceipt, WebsitePublicationClient } from "@workspace/integrations/website";
import type { RuntimeFs } from "@workspace/runtime";

type Journal = Pick<WebsitePublicationClient, "beginWebsitePublication" | "recordWebsitePublication">;
type Intent = Parameters<Journal["beginWebsitePublication"]>[0];
type Fs = Pick<RuntimeFs, "exists" | "readFile" | "writeFile" | "rename" | "readdir">;
type RegisteredFile = { file: string; sha: string; size: number };
type Deployment = { id: string; url: string; files: RegisteredFile[] };

const assetsEndpoint = "https://api.vercel.com/v2/files";
const deploymentsEndpoint = "https://api.vercel.com/v13/deployments";
const validSha = /^[a-f0-9]{40}$/u;
const privateCredential = "owned-preview-transport";

function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.split("/").every(segment =>
    /^[A-Za-z0-9_.-]+$/u.test(segment) && segment !== "." && segment !== "..",
  );
}

export function createOwnedPreviewProvider({ fs, directory, intent, journal, interruptSubmit = false }: {
  fs: Fs; directory: string; intent: Intent; journal: Journal; interruptSubmit?: boolean;
}) {
  if (intent.provider !== "vercel" || intent.environment !== "preview" ||
      !/^[a-z0-9-]+$/u.test(intent.destination))
    throw new Error("The disposable provider only accepts one owned Vercel preview intent.");
  const key = sha256Hex(new TextEncoder().encode(intent.operationId)).slice(0, 20);
  const origin = `https://preview-${key}.vibestudio-preview.invalid`;
  const deploymentPath = `${directory}/deployment.json`;
  let current: PublicationReceipt | undefined;
  let interrupt = interruptSubmit;
  const trace = {
    starts: [] as PublicationReceipt[], progress: [] as PublicationReceipt[],
    uploads: [] as { sha: string; size: number; stored: boolean }[],
    submissions: [] as ("interrupted" | "accepted" | "already-accepted")[],
  };

  function verifyIntent(request: Intent) {
    if (!isDeepStrictEqual(request, intent)) throw new Error("The preview provider rejects any other sealed intent.");
  }
  function requireActive(phase: "upload" | "submit") {
    const permitted = phase === "upload" ? current?.phase === "prepared" || current?.phase === "destination-ready"
      : current?.phase === "uploaded";
    if (!permitted) throw new Error("The native Host journal has not authorized this preview phase.");
  }
  async function writeAtomic(path: string, data: string | Uint8Array) {
    const pending = `${path}.pending`;
    await fs.writeFile(pending, data);
    await fs.rename(pending, path);
  }
  async function readAsset(sha: string) {
    if (!validSha.test(sha)) throw new Error("Invalid preview upload digest.");
    const result = await fs.readFile(`${directory}/sha1-${sha}`);
    if (!(result instanceof Uint8Array)) throw new Error("The preview store did not return exact artifact bytes.");
    return result;
  }
  async function readDeployment(): Promise<Deployment | null> {
    if (!await fs.exists(deploymentPath)) return null;
    return JSON.parse(String(await fs.readFile(deploymentPath, "utf8"))) as Deployment;
  }

  const credentials: WebsitePublicationClient = {
    async resolveCredential(request) {
      if (request.url !== assetsEndpoint || request.use !== "publish" ||
          (request.credentialId && request.credentialId !== privateCredential)) return null;
      return {
        id: privateCredential, label: "Disposable owned preview", scopes: [],
        audience: [{ url: assetsEndpoint, match: "exact" }, { url: deploymentsEndpoint, match: "exact" }],
        injection: { type: "header", name: "Authorization", valueTemplate: "Bearer {token}" },
        lifecycle: { state: "active", canRefresh: false },
      };
    },
    async beginWebsitePublication(request) {
      verifyIntent(request);
      current = await journal.beginWebsitePublication(request);
      trace.starts.push(structuredClone(current));
      return current;
    },
    async recordWebsitePublication(request, progress) {
      verifyIntent(request);
      current = await journal.recordWebsitePublication(request, progress);
      trace.progress.push(structuredClone(current));
      return current;
    },
    async publishFetch(request, url, init, options) {
      verifyIntent(request);
      const endpoint = String(url);
      if (init?.method !== "POST" || options?.credentialId !== privateCredential ||
          ![assetsEndpoint, deploymentsEndpoint].includes(endpoint))
        throw new Error("The disposable transport accepts only exact owned preview protocol requests.");
      if (endpoint === assetsEndpoint) {
        requireActive("upload");
        const headers = new Headers(init.headers);
        const sha = headers.get("x-vercel-digest") ?? "";
        const arrayBuffer = await new Response(init.body).arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const actualSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", arrayBuffer)),
          byte => byte.toString(16).padStart(2, "0")).join("");
        if (actualSha !== sha || headers.get("content-length") !== String(bytes.byteLength))
          throw new Error("The upload does not match its declared payload.");
        const path = `${directory}/sha1-${sha}`;
        const exists = await fs.exists(path);
        if (exists && sha256Hex(await readAsset(sha)) !== sha256Hex(bytes))
          throw new Error("A retained upload has different bytes under the same key.");
        if (!exists) await writeAtomic(path, bytes);
        trace.uploads.push({ sha, size: bytes.byteLength, stored: !exists });
        return new Response(null, { status: exists ? 409 : 200 });
      }
      requireActive("submit");
      if (interrupt) {
        interrupt = false;
        trace.submissions.push("interrupted");
        return new Response("The owned preview submission was interrupted before acceptance.", { status: 503 });
      }
      const input = JSON.parse(String(init.body)) as { name?: unknown; target?: unknown; files?: RegisteredFile[] };
      if (input.name !== intent.destination || input.target !== undefined || !Array.isArray(input.files) ||
          !input.files.some(({ file }) => file === "vibestudio-build.json") ||
          new Set(input.files.map(({ file }) => file)).size !== input.files.length)
        throw new Error("The deployment attempts a different preview destination or an invalid artifact.");
      for (const { file, sha, size } of input.files) {
        if (!validPath(file) || !Number.isSafeInteger(size) || (await readAsset(sha)).byteLength !== size)
          throw new Error("The deployment references an unavailable upload.");
      }
      const record = { id: `preview-${key}`, url: new URL(origin).host, files: input.files };
      const existing = await readDeployment();
      if (existing && !isDeepStrictEqual(existing, record))
        throw new Error("The preview operation is already bound to a different deployment.");
      if (!existing) await writeAtomic(deploymentPath, JSON.stringify(record));
      trace.submissions.push(existing ? "already-accepted" : "accepted");
      return Response.json({ id: record.id, url: record.url });
    },
  };

  async function serve(url: string) {
    const request = new URL(url);
    if (request.origin !== origin || request.search || request.hash) return new Response(null, { status: 404 });
    const deployment = await readDeployment();
    const file = deployment?.files.find(item => item.file === request.pathname.slice(1));
    if (!file) return new Response(null, { status: 404 });
    const bytes = await readAsset(file.sha);
    // Copy only the file's byte range. A Node Buffer can share a larger backing allocation.
    return new Response(bytes.byteLength === 0 ? null : Uint8Array.from(bytes));
  }

  return { credentials, serve, readDeployment, trace,
    currentReceipt: () => current ? structuredClone(current) : null,
    inspectStore: async () => (await fs.readdir(directory)).sort() };
}
