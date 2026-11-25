import {describe,it,expect} from "vitest";
import {observedChatWorkerIdentity} from "./native-domain-review.js";
import type {ChatIndex,ChatObservation,ChatWorker} from "@workspace-skills/open-chat-continuity/types";
const worker:ChatWorker={objectKey:"original",participantId:"native:original",active:true,revision:1,endedRevision:null,handle:"familiar",mode:"addressed-observer"};
const index:ChatIndex={scopes:[],original:{channelId:"chat",messageId:"message",senderId:"sender",text:"text"},openingWorker:worker};
const frame=(current:ChatWorker|null):ChatObservation=>({channelId:"chat",through:6,rows:[],consumer:{channelId:"chat",rows:[],settled:true},worker:current,receipt:index.original,retryId:null});
describe("native worker identity observations",()=>{
 it("preserves original identity across an actual membership lifecycle change",()=>{const current={...worker,revision:3,endedRevision:2};expect(observedChatWorkerIdentity(index,[frame(current)])).toEqual({opening:worker,current,sameObjectKey:true,sameParticipantId:true,currentlyActive:true,endedSinceOpening:true});});
 it("does not mistake a matching handle for the original object or participant",()=>{const fact=observedChatWorkerIdentity(index,[frame({...worker,objectKey:"replacement",participantId:"native:replacement",revision:3,endedRevision:2})]);expect(fact.sameObjectKey).toBe(false);expect(fact.sameParticipantId).toBe(false);});
 it("does not mistake detached original identity for currently active membership",()=>{const fact=observedChatWorkerIdentity(index,[frame({...worker,active:false,revision:2,endedRevision:2})]);expect(fact.sameObjectKey).toBe(true);expect(fact.currentlyActive).toBe(false);});
 it("does not manufacture an original worker from an empty opening or missing current readback",()=>{expect(observedChatWorkerIdentity({...index,openingWorker:null},[frame(worker)]).sameParticipantId).toBe(false);expect(observedChatWorkerIdentity(index,[]).currentlyActive).toBe(false);expect(observedChatWorkerIdentity(index,[frame(null)]).sameObjectKey).toBe(false);});
});
