import {managedPresentationWorlds} from "./presentation-worlds.js";
import { expect,it } from "vitest";
import { checkPresentation,referencePresentation } from "./presentation-managed.js";
import { renderComponent } from "@workspace-skills/visualize/render";
import { openLocalPresentationWorlds } from "./open-goal-local-presentation-worlds.js";
it("checks requested comparison data while allowing a grounded optional heading",()=>{
  const world=openLocalPresentationWorlds.find(world=>world.id.endsWith("tool-station-equipment"))!;
  const requirements=world.expected.requirements!;
  const report=referencePresentation(requirements);
  const view=report.views[0];
  if(view?.status!=="ready"||view.rendered.component!=="Compare")throw new Error("Expected bench comparison");
  view.rendered=renderComponent({component:"Compare",props:{...view.rendered.props,title:"Interchangeable benches"}});
  expect(checkPresentation(requirements,report)?.[0]?.mdx).toContain("Interchangeable benches");
  const wrong=structuredClone(report);
  const changed=wrong.views[0];
  if(changed?.status!=="ready"||changed.rendered.component!=="Compare")throw new Error("Expected comparison");
  changed.rendered=renderComponent({component:"Compare",props:{...changed.rendered.props,
    options:changed.rendered.props.options.map((option,index)=>index?option:{...option,attributes:{...option.attributes,Sockets:99}})}});
  expect(checkPresentation(requirements,wrong)).toBeNull();
  view.rendered=renderComponent({component:"Compare",props:{...view.rendered.props,title:"North has 99 sockets"}});
  expect(checkPresentation(requirements,report)).toBeNull();
});

it("does not prescribe English keywords for a structurally correct missing-data disposition",()=>{
 const world=managedPresentationWorlds.find(world=>world.expected.some(view=>view.status==="needs-review"))!;
 const report=referencePresentation(world),held=report.views.find(view=>view.status==="needs-review");
 if(!held||held.status!=="needs-review")throw Error("Expected missing-data view");
 held.reason="No measurements have been supplied for that comparison.";
 expect(checkPresentation(world,report)).not.toBeNull();
 held.reason="";expect(checkPresentation(world,report)).toBeNull();
});

it("still requires the actual recorded refrigeration view and excludes the unrelated rumor",()=>{
 const world=openLocalPresentationWorlds.find(world=>world.id==="present-local-cold-storage-status")!;
 const requirements=world.expected.requirements!;
 const report=referencePresentation(requirements);
 expect(checkPresentation(requirements,report)?.[0]?.mdx).toContain("-18");
 expect(checkPresentation(requirements,{views:[{id:"temperature",status:"needs-review",reason:"Unavailable"}],omitted:["rumor"]})).toBeNull();
 const wrong=structuredClone(report),view=wrong.views[0];
 if(view?.status!=="ready"||view.rendered.component!=="Stats")throw new Error("Expected recorded refrigeration values");
 view.rendered=renderComponent({component:"Stats",props:{items:[{label:"Lowest temperature",value:"-11 °C"},{label:"Open alarms",value:2}]}});
 expect(checkPresentation(requirements,wrong)).toBeNull();
 expect(checkPresentation(requirements,{...report,omitted:[]})).toBeNull();
});
