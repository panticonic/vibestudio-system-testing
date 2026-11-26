import {sha256HexSyncText as hash} from "@vibestudio/content-addressing";
export function nativeSemanticFixturePorts(seed:{path:string;files:{path:string;text:string}[]}[]=[]){
 let serial=0,working='head-0',committed='head-0';
 type File={fileId:string;path:string;content:{kind:'text';text:string};mode:number;contentHash:string};
 type Repo={repositoryId:string;repoPath:string;files:Map<string,File>};
 const initial=new Map<string,Repo>(seed.map(repo=>[repo.path,{repositoryId:repo.path,repoPath:repo.path,files:new Map(repo.files.map(file=>[file.path,{fileId:repo.path+'/'+file.path,path:file.path,content:{kind:'text',text:file.text},mode:0o644,contentHash:hash(file.text)}]))}]));
 const snapshots=new Map<string,Map<string,Repo>>([['head-0',structuredClone(initial)],['protected',structuredClone(initial)]]),scratch=new Map<string,string>(),dirs=new Set<string>();
 const state=(id:string)=>({kind:'event',eventId:id}),get=(id:string)=>snapshots.get(id)!;
 const status=async()=>({contextId:'owner',mainEventId:'protected',workingHead:state(working),committed:state(committed),clean:working===committed,integrating:[],mainRelation:'ahead'});
 const vcs={status,mainState:async()=>state("protected"),
  edit:async(input:any)=>{
   const next=structuredClone(get(working));
   for(const c of input.changes){
    if(c.kind==='repository-create'){const repositoryId=c.repoPath;next.set(repositoryId,{repositoryId,repoPath:c.repoPath,files:new Map(c.files.map((f:any)=>[f.path,{...f,fileId:c.repoPath+'/'+f.path,contentHash:hash(f.content.text)}]))});}
    else {const repo=next.get(c.repositoryId)!;
     if(c.kind==='file-create')repo.files.set(c.path,{...c,fileId:repo.repoPath+'/'+c.path,contentHash:hash(c.content.text)});
     else {const row=[...repo.files.values()].find(f=>f.fileId===c.fileId)!;if(c.kind==='file-delete')repo.files.delete(row.path);else repo.files.set(row.path,{...row,content:c.content,contentHash:hash(c.content.text)});}
    }
   }
   working='head-'+(++serial);snapshots.set(working,next);return{workingHead:state(working)};
  },
  commit:async()=>{committed=working;return{event:state(committed)};},
  resolveRepository:async({state:s,repoPath}:any)=>{const r=get(s.eventId)?.get(repoPath);return r?{repositoryId:r.repositoryId,repoPath}:null;},
  readFile:async({state:s,repositoryId,file}:any)=>get(s.eventId)?.get(repositoryId)?.files.get(file.path)??null,
 };
 const fileView=async(s:any,repository:string,path:string)=>{const f=await vcs.readFile({state:s,repositoryId:repository,file:{path}});return f?{fileId:f.fileId,hash:f.contentHash,mode:f.mode,excerpt:f.content.text,truncated:false}:null;};
 const fs={mkdtemp:async(prefix:string)=>{const dir=prefix+'-'+crypto.randomUUID().replaceAll('-','');dirs.add(dir);return'/.tmp/'+dir;},writeFile:async(p:string,s:string)=>{scratch.set(p,s);},rename:async(a:string,b:string)=>{scratch.set(b,scratch.get(a)!);scratch.delete(a);},rm:async(p:string)=>{dirs.delete(p.split('/').at(-1)!);},exists:async(path:string)=>scratch.has(path),readdir:async()=>[...dirs]};
 return{contextId:'owner',vcs,fs,readBytes:async(p:string)=>new TextEncoder().encode(scratch.get(p)!),
  bindGit:({repository}:any)=>{const operationId=crypto.randomUUID();return{request:{operationId},services:{gitBridgeReviewRead:{observe:async()=>{const s=await status();return{repository,upstream:{state:'local-only'},semantic:{contextId:'owner',current:true,workingRepositoryId:repository,mainRepositoryId:null}};}}}};},
  bindDelivery:({repository,path}:any)=>{const operationId=crypto.randomUUID();return{request:{operationId},services:{vcsDeliveryRead:{observe:async()=>{const s=await status(),current=await fileView(s.workingHead,repository,path),prior=await fileView(s.committed,repository,path);return{contextId:'owner',current:true,working:s.workingHead,committed:s.committed,protectedMain:state('protected'),file:{path,working:current,committed:prior,protectedMain:null,hasLocalDifference:current?.hash!==prior?.hash}};}}}};},
 } as any;
}
