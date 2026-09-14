import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { buildProjectManifest } from "@workspace-skills/workspace-dev/project-manifest";
import type { VcsClient } from "@workspace/runtime";

export function imagePanelFixtureFiles(name: string): Record<string, string> {
  const manifest = buildProjectManifest({
    projectType: "panel",
    name,
    title: "Live Image Studio",
    entry: "index.tsx",
    exposeModules: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    dependencies: {
      react: "19.2.4",
      "react-dom": "19.2.4",
      "@workspace/react": "workspace:*",
      "@workspace/runtime": "workspace:*",
    },
  });
  const vibestudio = manifest["vibestudio"] as Record<string, unknown>;
  const authority = vibestudio["authority"] as Record<string, unknown>;
  vibestudio["stateArgs"] = {
    type: "object",
    properties: {
      jobs: { type: "array", items: { type: "string" } },
      selectedJob: { type: "string" },
    },
    additionalProperties: false,
  };
  vibestudio["authority"] = {
    ...authority,
    requests: [
      ...((authority["requests"] as unknown[]) ?? []),
      {
        capability: "workspace.runtime-state.manage",
        resource: { kind: "exact", key: "workspace.runtime-state.manage" },
        tier: "gated",
        evidence: "exact",
      },
      {
        capability: "workspace-service:images",
        resource: { kind: "exact", key: "do:workers/images:ImagesDO:workspace" },
        tier: "gated",
        evidence: "exact",
      },
    ],
    serviceRequests: [{ protocol: "vibestudio.images.v1", availability: "required" }],
  };
  return {
    "package.json": JSON.stringify(manifest, null, 2) + "\n",
    "index.tsx": `import { images, panel } from "@workspace/runtime";
import { GeneratedImage } from "@workspace/react";
import { useEffect, useState } from "react";
import type { ImageAsset } from "@workspace/runtime/images";
const boot = crypto.randomUUID();
const saved = panel.stateArgs.get<{jobs?:string[];selectedJob?:string}>();
let jobs = saved.jobs ?? [];
export default function LiveImageStudio() {
  const [asset,setAsset] = useState<ImageAsset | null>(null);
  const [status,setStatus] = useState("idle");
  const [error,setError] = useState("");
  const [jobId,setJobId] = useState(saved.selectedJob ?? "");
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    setStatus("waiting");
    void images.wait(jobId, {signal:controller.signal}).then(result => {
      if (controller.signal.aborted) return;
      setStatus(result.status);
      if (result.status === "succeeded" && result.asset) setAsset(result.asset);
      else setError(result.error ?? (result.status === "succeeded" ? "Generation returned no image asset" : "Image generation " + result.status));
    }, cause => {
      if (!controller.signal.aborted) {setError(String(cause));setStatus("failed");}
    });
    return () => controller.abort();
  },[jobId]);
  const generate = async (reference:boolean) => {
    setError(""); setStatus("starting");
    try {
      const job = await images.generate({requestId:crypto.randomUUID(),prompt:reference ? "Paint this same moonlit ferry landing at dawn. Preserve its composition, buildings, and restrained gouache brushwork; warm pink sunrise, no lettering." : "A moonlit ferry landing with a tiny weathered customs house, wet cobblestones and warm brass lanterns. Classic painted adventure-game background, restrained gouache, indigo shadows and amber light, no lettering.",size:"1536x1024",quality:"low",references:reference && asset ? [asset] : []});
      jobs = [...jobs,job.id]; setJobId(job.id);
      await panel.stateArgs.set({jobs,selectedJob:job.id});
    } catch(cause) { setError(String(cause));setStatus("failed"); }
  };
  return <main data-testid="image-studio" data-boot={boot} data-job={jobId} data-asset={asset?.id ?? ""} data-digest={asset?.digest ?? ""} data-status={status}>
    <h1>Live Image Studio</h1>
    <button data-testid="generate" disabled={status==="starting" || status==="waiting"} onClick={() => void generate(false)}>Paint the landing</button>
    <button data-testid="reference" disabled={!asset || status==="starting" || status==="waiting"} onClick={() => void generate(true)}>Paint dawn using this image</button>
    <output data-testid="generation-status">{status}</output>
    {error && <pre data-testid="generation-error">{error}</pre>}
    <GeneratedImage asset={asset} alt="The ferry landing" data-testid="generated-scene" style={{maxWidth:"100%",height:"auto"}} />
  </main>;
}
`,
  };
}
export async function importImagePanelFixture(input: {
  vcs: VcsClient;
  blobstore: { putText(text: string): Promise<{ digest: string }> };
  contextId: string;
  name: string;
}) {
  const status = await input.vcs.status({ contextId: input.contextId });
  const files = await Promise.all(
    Object.entries(imagePanelFixtureFiles(input.name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([path, text]) => ({
        path,
        contentHash: (await input.blobstore.putText(text)).digest,
        mode: 0o644,
      }))
  );
  const repoPath = `panels/${input.name}`;
  await input.vcs.importSnapshot({
    contextId: input.contextId,
    commandId: `system-test:${input.name}:import`,
    expectedWorkingHead: status.workingHead,
    intentSummary: "Create the live image panel fixture",
    message: "Create live image panel fixture",
    source: {
      kind: "generated",
      uri: "system-test://image-panel-live-generation",
      snapshotRevision: `fixture:${sha256HexSyncText(JSON.stringify(files))}`,
    },
    repositories: [{ repoPath, files }],
  });
  return { repoPath, contextId: input.contextId };
}
