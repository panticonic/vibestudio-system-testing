import type {createProjectDelivery} from "@workspace/natlang-services";
type Project=ReturnType<typeof createProjectDelivery>;
type Scope={initialHead:string;prepared:boolean;written:boolean;committed:boolean};
type Ports={
 requireScope(receipt:string|null):{scope:Scope;project:Project};
 currentSources():Promise<boolean>;
 onCurrentBasis<T>(head:string,operation:()=>Promise<T>):Promise<T|null>;
 record<T>(service:string,method:string,args:unknown[],result:T):T;
};
/** A project lease permits observations and repairs, while every write keeps exact source authority and CAS. */
export function createScopedProjectDraft(ports:Ports){
 return {
  async observe(receipt:string|null){
   const {project}=ports.requireScope(receipt);
   return ports.record("contentProjectDraft","observe",[receipt],await project.observe());
  },
  async prepare(receipt:string|null,head:string){
   const {scope,project}=ports.requireScope(receipt);
   if(scope.committed||!await ports.currentSources())return null;
   if(scope.prepared){
    const snapshot=await project.observe();
    return ports.record("contentProjectDraft","prepare",[receipt,head],head===scope.initialHead||head===snapshot.head?snapshot:null);
   }
   const snapshot=await ports.onCurrentBasis(head,()=>project.prepare(head));
   scope.prepared=snapshot!==null;
   return ports.record("contentProjectDraft","prepare",[receipt,head],snapshot);
  },
  async write(receipt:string|null,head:string,documents:{path:string;text:string}[]){
   const {scope,project}=ports.requireScope(receipt);
   if(!scope.prepared||scope.committed)throw new Error("Write only within the prepared private project before its local commit");
   if(!await ports.currentSources())return null;
   const snapshot=await ports.onCurrentBasis(head,()=>project.writeDocuments(head,documents));
   scope.written=scope.written||snapshot!==null;
   return ports.record("contentProjectDraft","write",[receipt,head,documents],snapshot);
  },
 };
}
