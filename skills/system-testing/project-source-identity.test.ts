import {expect,it} from "vitest";
import {sameProjectSourceSelection as same} from "./project-source-identity.js";
it("binds the same exact fact coordinates in any order while refusing stale or foreign references",()=>{
 const references=[{source:"requirements",digest:"current-a",fact:"step"},{source:"approval",digest:"current-b",fact:"permit"}];
 expect(same([...references].reverse(),references)).toBe(true);
 expect(same([...references,references[0]!],references)).toBe(true);
 expect(same([{...references[0]!,digest:"retired"},references[1]!],references)).toBe(false);
 expect(same([references[0]!],references)).toBe(false);
});
