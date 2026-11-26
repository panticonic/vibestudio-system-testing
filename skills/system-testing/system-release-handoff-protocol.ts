import {sha256HexSyncText} from "@vibestudio/content-addressing";
import {maxScratchArtifactBytes} from "@workspace-skills/scratch-handoff-bindings";
/** Describe an independently verified local artifact, without claiming delivery.
 * livePorts uses the host's context-resolved scratch filesystem. The verifier
 * separately checks its unique output path, native cases and exact bytes. */
export function systemReleaseHandoffProtocol(input:{contextId:string;verifiedPrivateHandoff:boolean;receipt:{path:string;bytes:number;sha256:string}|null;text:string|null}) {
 const {receipt,text}=input;
 if(!input.verifiedPrivateHandoff||!receipt||text===null||!receipt.path.startsWith("/.tmp/")||receipt.path.split("/").includes(".."))return null;
 const bytes=new TextEncoder().encode(text).byteLength;
 if(bytes>maxScratchArtifactBytes||bytes!==receipt.bytes||sha256HexSyncText(text)!==receipt.sha256)return null;
 let body:unknown;try{body=JSON.parse(text);}catch{return null;}
 if(!body||typeof body!=="object"||Array.isArray(body)||(body as Record<string,unknown>).protocol!=="vibestudio-local-system-release-review.v1"||(body as Record<string,unknown>).contextId!==input.contextId)return null;
 return {protocol:"vibestudio-local-system-release-review.v1",writer:"systemReleaseHandoff.stage",purpose:"local-release-review",contextId:input.contextId,storage:"context-scoped-scratch",externalTransmission:false,path:receipt.path,bytes,sha256:receipt.sha256};
}
