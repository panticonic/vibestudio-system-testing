import {expect,it} from "vitest";
import {observedRealmCapacity,realmCapacityReviewGuidance} from "./native-domain-review.js";
import {exampleReference} from "@workspace-skills/examples-review-fixtures/oracle";
it.each([[2.6,2.6,true],[2.5,2.6,true],[2.7,2.6,false],[null,2.6,null],[2.6,null,null]])("uses the installed measured-capacity contract for cargo%s/capacity%s",(cargo,capacity,within)=>{
 const state={id:"native-snapshot",month:2,treasury:1,debt:0,income:0,spending:0,serviceCost:0,worksCost:0,regions:[],borderTension:null,routes:[{id:"east-crossing",cargo,capacity,subsidy:0,condition:1,progress:0,workers:0}]};
 const actual=observedRealmCapacity(state as never,"forecast");expect(actual.routes[0].withinMeasuredCapacity).toBe(within);expect(actual.basis).toBe("forecast");
 const reference=exampleReference({kind:"realm",review:{kind:"settlement",check:{kind:"cargo-under-capacity",route:"east-crossing"},current:state}} as never);expect(reference.decision).toBe(within===null?"not-observed":within?"supported":"contradicted");
 expect(realmCapacityReviewGuidance).toContain("Equality satisfies within-capacity");expect(realmCapacityReviewGuidance).toContain("explicit user requirement");
});
