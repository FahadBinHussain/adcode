import { expect, it } from "vitest";
import { createAgent } from "../src/agent.ts";
import { historyForModelSwitch } from "../src/modelHandoff.ts";
import { restoreHistory } from "../src/sessions.ts";
import { createOpenAiCompatibleProvider } from "../src/providers/openaiCompatible.ts";
import type { AgentEvent, Message, Provider } from "../src/types.ts";

const collect=async(events:AsyncIterable<AgentEvent>)=>{const all:AgentEvent[]=[];for await(const event of events)all.push(event);return all;};
it("transfers completed tool work and the user's task to another provider's real wire format",async()=>{
  let calls=0;let toolRuns=0;
  const old:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){if(++calls===1){yield{kind:"tool-call",call:{type:"tool-call",id:"edit-1",name:"edit_file",input:{path:"app.ts"},reasoning:{provider:"tagflow",model:"old",text:"private provider wire reasoning"}}};yield{kind:"stop",reason:"tool-use"};}else{yield{kind:"text",text:"Fixed app.ts; tests passed."};yield{kind:"stop",reason:"end-turn"};}}};
  const first=createAgent({provider:old,model:"old",tools:[{name:"edit_file",description:"Edit file",inputSchema:{type:"object"},mutating:true}],runner:{run:async()=>{toolRuns++;return{content:"Applied edit to app.ts. Verified all three tests pass.",isError:false};}}});
  await collect(first.send("Fix the start button and keep the existing theme."));
  let sent:Record<string,unknown>|undefined;
  const next=createOpenAiCompatibleProvider({id:"openai",displayName:"OpenAI",baseUrl:"https://api.openai.test/v1",apiKey:"test",models:["new"],fetchImpl:async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response('data: {"choices":[{"delta":{"content":"I remember the fixed button and theme."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});}});
  const second=createAgent({provider:next,model:"new",tools:[],initialMessages:historyForModelSwitch(first.history()),runner:{run:async()=>{throw new Error("Completed tools must not run again");}}});
  const events=await collect(second.send("Continue with the next part."));
  expect(events.filter(event=>event.kind==="error")).toEqual([]);
  const wire=JSON.stringify(sent);
  expect(wire).toContain("Fix the start button and keep the existing theme");
  expect(wire).toContain("Applied edit to app.ts. Verified all three tests pass");
  expect(wire).toContain("Fixed app.ts; tests passed");expect(wire).toContain('"role":"tool"');
  expect(wire).not.toContain("private provider wire reasoning");expect(toolRuns).toBe(1);
});
it("preserves a compacted summary and recent chat without changing the original history",()=>{
  const restored=restoreHistory({id:"chat",title:"Task",renamed:false,createdAt:0,updatedAt:0,messages:[{role:"user",text:"old request",at:1},{role:"assistant",text:"old response",at:2},{role:"user",text:"Keep the theme blue",at:3}],summary:{text:"The app uses React and the start button is fixed.",coversUntil:2,at:2}});
  const tool:Message={role:"assistant",content:[{type:"tool-call",id:"call",name:"read_file",input:{path:"app.ts"},reasoning:{provider:"old",model:"old-model",details:[{private:true}]}}]};
  const original=[...restored,tool];const transferred=historyForModelSwitch(original);
  expect(JSON.stringify(transferred)).toContain("The app uses React and the start button is fixed");
  expect(JSON.stringify(transferred)).toContain("Keep the theme blue");expect(JSON.stringify(transferred)).not.toContain('"reasoning"');
  expect(JSON.stringify(original)).toContain('"reasoning"');
  expect(transferred).not.toBe(original);expect(transferred[0]?.content).not.toBe(original[0]?.content);
});
