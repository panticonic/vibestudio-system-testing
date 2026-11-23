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
