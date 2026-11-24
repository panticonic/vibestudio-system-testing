import {workspaceEditScope}from "./workspace-edit-evidence.js";
/** Match actual atomic file identities and protected text, not authored example prose. */
export function coordinatedEditScope(drafts:readonly {path:string;version:string;text:string}[],reference:readonly {path:string;version:string;text:string}[],basis:readonly {path:string;text:string}[]){
 if(drafts.length!==reference.length||new Set(drafts.map(draft=>draft.path)).size!==drafts.length)return false;
 return drafts.every(draft=>{
  const expected=reference.find(row=>row.path===draft.path),before=basis.find(row=>row.path===draft.path)?.text;
  if(!expected||draft.version!==expected.version||before===undefined||draft.text===before)return false;
  const scope=workspaceEditScope({goal:"",files:{[draft.path]:before},destination:draft.path,source:"",concurrentAddition:"",expected:expected.text});
  return draft.text.startsWith(scope.prefix)&&draft.text.endsWith(scope.suffix)&&draft.text.length>scope.prefix.length+scope.suffix.length;
 });
}
