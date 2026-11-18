import {createProjectDelivery} from "@workspace/natlang-services";
import {verifyContentProject} from "./content-project-oracle.js";
import type {ContentProjectInput} from "./content-project-contract.js";
/** No model calls: actual product lifecycle used only to qualify structural verifier. */
export async function runContentProjectReference(ports:Parameters<typeof createProjectDelivery>[0] & {vcs:Parameters<typeof verifyContentProject>[0]},assignment:ContentProjectInput,variant:"reference"|"negative") {
  const before=await ports.vcs.status({contextId:assignment.contextId});
  const service=createProjectDelivery(ports,assignment);
  const absent=await service.observe();
  if(absent.repositoryId||!before.clean)throw new Error("Content reference needs a fresh clean assigned world");
  const prepared=await service.prepare(absent.head);
  const facts=variant==="negative"?assignment.request.facts.slice(1):assignment.request.facts;
  const documents=[{path:"README.md",text:`# ${assignment.title}\n[Guide](docs/guide.md)\n`},{path:"docs/guide.md",text:assignment.request.documentRoles.map(role=>`## ${role}`).join("\n")+"\n"+facts.map(f=>`${f.text} [fact:${f.id}]`).join("\n")}];
  const written=await service.writeDocuments(prepared.head,documents);
  await service.commit(written.head,"Prepare grounded content verifier reference");
  return verifyContentProject(ports.vcs,{contextId:assignment.contextId,repoPath:`projects/${assignment.name}`,request:structuredClone(assignment.request),before});
}
