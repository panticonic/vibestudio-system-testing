import {isDeepStrictEqual} from "node:util";
/** Check the retained application content, never a later optional summary. */
export function recoveryHandoffMatches(text:string,expected:{disposition:string;citations:unknown;reason?:readonly string[]}):boolean{
 let saved:unknown;try{saved=JSON.parse(text);}catch{return false;}
 if(!saved||typeof saved!=="object"||!("schema" in saved)||saved.schema!=="vibestudio.session-recovery-handoff/1"||!("review" in saved))return false;
 const review=saved.review;
 return !!review&&typeof review==="object"&&"disposition" in review&&review.disposition===expected.disposition&&
  "citations" in review&&isDeepStrictEqual(review.citations,expected.citations)&&"reason" in review&&typeof review.reason==="string"&&!!review.reason.trim()&&
  (expected.reason??[]).every(term=>typeof review.reason==="string"&&review.reason.toLowerCase().includes(term.toLowerCase()));
}
/** These cases explicitly request quoted message facts; acknowledge the actual body. */
export function deliveredFactsMatch(content:string,facts:readonly string[]):boolean{return facts.every(fact=>content.includes(fact));}
