import { sha256Hex } from "@vibestudio/content-addressing";
import { ImagesDO } from "@workspace-workers/images";
import { rpc } from "@workspace/runtime/worker/kernel";
import type { CodexSession } from "@workspace/harness/image-generation";
import type { ImageFixtureReceipt, ImageFixtureSeed, ImageJobFixtureControl } from "./contract.js";

/** TestKit only. The production ImagesDO resolves its ordinary credential session. */
export class ImageJobFixtureDO extends ImagesDO implements ImageJobFixtureControl {
  protected override createTables() {
    super.createTables();
    this.sql.exec("CREATE TABLE image_fixture_config (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, configuration TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE image_fixture_requests (ordinal INTEGER PRIMARY KEY, receipt TEXT NOT NULL)");
  }
  protected override requiredTables() {
    return [...super.requiredTables(),"image_fixture_config","image_fixture_requests"];
  }
  @rpc({website:{kind:"closed",reason:"Owned deterministic fixture control for System Testing."},principals:["code"],effect:{kind:"open"},tier:"open",sensitivity:"write"})
  async configure(input: ImageFixtureSeed) {
    const owner = this.caller?.callerId;
    if (!owner || !input.steps.length || input.steps.length > 3 || input.steps.some(step => !["ok","unavailable","wrong-format"].includes(step)) ||
        ["png","jpeg","webp"].some(format => typeof input.originals[format as keyof ImageFixtureSeed["originals"]] !== "string" ||
          input.originals[format as keyof ImageFixtureSeed["originals"]].length > 8192)) throw new Error("Invalid owned fixture transport configuration");
    this.sql.exec("INSERT INTO image_fixture_config(id,owner,configuration) VALUES (1,?,?)",owner,JSON.stringify(input));
  }
  @rpc({website:{kind:"closed",reason:"Owned deterministic fixture control for System Testing."},principals:["code"],effect:{kind:"open"},tier:"open",sensitivity:"read"})
  async readFixtureTransport(): Promise<ImageFixtureReceipt[]> {
    const owner = this.sql.exec("SELECT owner FROM image_fixture_config WHERE id=1").toArray()[0]?.["owner"];
    if (!owner || owner !== this.caller?.callerId) throw new Error("Fixture audit escaped its admitted caller");
    return this.sql.exec("SELECT receipt FROM image_fixture_requests ORDER BY ordinal").toArray().map(row=>JSON.parse(String(row["receipt"])));
  }
  protected override async resolveSession(session: string): Promise<CodexSession> {
    const row = this.sql.exec("SELECT configuration FROM image_fixture_config WHERE id=1").toArray()[0];
    if (!row) throw new Error("Missing owned deterministic image transport");
    const plan = JSON.parse(String(row["configuration"])) as ImageFixtureSeed;
    return {model:"owned-image-transport",accountId:"fixture-local",sessionId:session,fetcher:async (url,init)=>{
      if (url!=="https://chatgpt.com/backend-api/codex/responses" || init?.method!=="POST" || typeof init.body!=="string")
        throw new Error("Unexpected destination or body for deterministic image transport");
      const body = JSON.parse(init.body);
      const format = body.tools?.[0]?.output_format as keyof ImageFixtureSeed["originals"];
      const content = body.input?.[0]?.content;
      if (!Object.hasOwn(plan.originals,format) || !Array.isArray(content) || content[0]?.type!=="input_text" ||
          body.tools?.length!==1 || body.tools[0].type!=="image_generation" || body.store!==false || body.stream!==true)
        throw new Error("Generation did not send its native exact protocol");
      const index = Number(this.sql.exec("SELECT COUNT(*) AS n FROM image_fixture_requests").toArray()[0]?.["n"]??0);
      const outcome = plan.steps[index];
      if (!outcome) throw new Error("Unexpected duplicate provider request in owned image fixture");
      const referenceDigests=content.slice(1).map(item=>{
        const match=typeof item.image_url==="string" && /^data:image\/(?:png|jpeg|webp);base64,(.+)$/u.exec(item.image_url);
        if(item.type!=="input_image"||!match)throw new Error("Generation lacks its exact inline image reference");
        return sha256Hex(Uint8Array.from(atob(match[1]),char=>char.charCodeAt(0)));
      });
      const receipt:ImageFixtureReceipt={index,session,format,prompt:content[0].text,referenceDigests,outcome};
      this.sql.exec("INSERT INTO image_fixture_requests(ordinal,receipt) VALUES (?,?)",index,JSON.stringify(receipt));
      if (outcome==="unavailable") return new Response("Local fixture indicates a temporary generation failure",{status:503});
      const original = plan.originals[outcome==="wrong-format"?(format==="png"?"jpeg":"png"):format];
      const item={type:"image_generation_call",id:`fixture-image-${index}`,result:original,revised_prompt:"Owned fixture bytes only"};
      return new Response(`event: response.output_item.done\ndata: ${JSON.stringify({item})}\n\nevent: response.completed\ndata: ${JSON.stringify({response:{id:`fixture-response-${index}`,output:[item]}})}\n\n`,
        {headers:{"content-type":"text/event-stream"}});
    }};
  }
}
