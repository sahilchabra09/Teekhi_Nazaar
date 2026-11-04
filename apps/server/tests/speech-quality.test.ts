import { beforeEach, expect, mock, test } from "bun:test";

let confidence = 0.1;
let turns = 0;
let generations = 0;
mock.module("../src/rbac", () => ({
  requireSession: async (c: any, next: () => Promise<void>) => { c.set("user", {id:"patient",name:"Patient",role:"patient"}); await next(); },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
mock.module("../src/env.server", () => ({ENV:{OPENROUTER_API_KEY:"synthetic-test-key"}}));
mock.module("../src/autosage/client", () => ({autosageConfigured:() => false}));
mock.module("../src/talk/ai", () => ({
  TalkError: class extends Error {}, models:{stt:[]},
  speechToText:async () => ({text:"Words that may be wrong", confidence, model:"test-stt",language:"en"}),
  isLowConfidence:(value:number|null) => value !== null && value < .55,
}));
mock.module("../src/talk/conversations", () => ({
  openConversation:async () => ({id:"conversation",shownReplies:[]}),
  addTurn:async () => { turns++; }, addShownReplies:async () => {},
  endConversation:async () => {}, getConversation:async () => null, lastHeard:async () => null,
}));
mock.module("../src/talk/replies", () => ({generateReplies:async () => {
  generations++; return {replies:["Yes","No","Later"],unclear:false,source:"openrouter",model:"test-replies"};
}}));
const {talkRoutes} = await import("../src/talk/routes");
beforeEach(() => { confidence=.1; turns=0; generations=0; });

test("low-confidence audio is rejected before recording history or asking for replies", async () => {
  const body = new FormData(); body.set("audio",new File([new Uint8Array(16000)],"clip.wav",{type:"audio/wav"}));
  const response = await talkRoutes.request("/utterance",{method:"POST",body});
  expect((await response.json() as any).status).toBe("no_speech");
  expect(turns).toBe(0); expect(generations).toBe(0);
});
test("low-confidence Android text is rejected by the same reply boundary", async () => {
  const response = await talkRoutes.request("/transcript",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"Unreliable words",confidence:.1})});
  expect((await response.json() as any).status).toBe("no_speech");
  expect(turns).toBe(0); expect(generations).toBe(0);
});
test("accepted Android text is added once and generates replies once", async () => {
  const response = await talkRoutes.request("/transcript",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"Would you like water?",confidence:.9})});
  expect((await response.json() as any).status).toBe("ok");
  expect(turns).toBe(1); expect(generations).toBe(1);
});
