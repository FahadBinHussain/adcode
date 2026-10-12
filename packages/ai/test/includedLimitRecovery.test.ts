import { afterEach, expect, it, vi } from "vitest";
import { recoverIncludedLimits } from "../src/includedLimitRecovery.ts";
import type { Provider, ProviderEvent, ProviderRequest } from "../src/types.ts";
const request: ProviderRequest = {model:"coder",system:"Current task",messages:[],tools:[],maxTokens:100};
const collect=async(provider:Provider,signal=new AbortController().signal)=>{const events:ProviderEvent[]=[];for await(const event of provider.stream(request,signal))events.push(event);return events;};
afterEach(()=>vi.useRealTimers());

it("resumes the exact pending request at the daily reset without a new message",async()=>{
  vi.useFakeTimers();vi.setSystemTime(Date.parse("2026-10-11T23:59:55Z"));const seen:ProviderRequest[]=[];
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(input){seen.push(input);if(seen.length===1)throw{status:429,code:"daily-limit",retryable:true,resetsAt:Date.parse("2026-10-12T00:00:00Z"),retryAfter:"5"};yield{kind:"text",text:"Continuing"};yield{kind:"stop",reason:"end-turn"};}};
  const result=collect(recoverIncludedLimits(provider));await vi.advanceTimersByTimeAsync(4999);expect(seen).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);const events=await result;expect(seen).toEqual([request,request]);expect(seen[0]).toBe(seen[1]);
  expect(events.some(event=>event.kind==="status"&&event.text.includes("resume automatically"))).toBe(true);
  expect(events.filter(event=>event.kind==="text")).toEqual([{kind:"text",text:"Continuing"}]);
});
it("can wait a full day without exhausting attempts",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){if(++calls===1)throw{status:429,code:"daily-limit",retryAfter:"86400"};yield{kind:"stop",reason:"end-turn"};}};
  const result=collect(recoverIncludedLimits(provider));await vi.advanceTimersByTimeAsync(86_399_999);expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(1);await result;expect(calls).toBe(2);expect(vi.getTimerCount()).toBe(0);
});
it("keeps retrying temporary provider limits until the provider accepts",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){if(++calls<5)throw{status:429,code:"upstream-rate-limit",retryAfter:"2"};yield{kind:"stop",reason:"end-turn"};}};
  const result=collect(recoverIncludedLimits(provider));await vi.advanceTimersByTimeAsync(7999);expect(calls).toBe(4);
  await vi.advanceTimersByTimeAsync(1);await result;expect(calls).toBe(5);
});
it("cancels immediately without another request or a dangling timer",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let calls=0;const controller=new AbortController();
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){calls++;throw{status:429,code:"daily-limit",retryAfter:"86400"};}};
  const result=collect(recoverIncludedLimits(provider),controller.signal).catch(error=>error.name);
  await vi.advanceTimersByTimeAsync(0);controller.abort();expect(await result).toBe("AbortError");
  await vi.advanceTimersByTimeAsync(86_400_000);expect(calls).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
it("resumes after computer sleep using wall time",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){if(++calls===1)throw{status:429,code:"daily-limit",retryAfter:"86400"};yield{kind:"stop",reason:"end-turn"};}};
  const result=collect(recoverIncludedLimits(provider));await vi.advanceTimersByTimeAsync(0);
  vi.setSystemTime(86_400_000);await vi.advanceTimersByTimeAsync(60_000);await result;expect(calls).toBe(2);
});
it.each(["text","tool-call"] as const)("never replays partial %s",async kind=>{
  vi.useFakeTimers();let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){calls++;yield kind==="text"?{kind:"text",text:"partial"}:{kind:"tool-call",call:{type:"tool-call",id:"write",name:"edit_file",input:{}}};throw{status:429,code:"rate-limit",retryAfter:"60"};}};
  await expect(collect(recoverIncludedLimits(provider))).rejects.toMatchObject({status:429});expect(calls).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
it.each([{status:429,code:"daily-limit",retryable:false},{status:403,code:"banned"},{status:429,code:"credits"}])("does not retry permanent or unrelated errors: %j",async error=>{
  vi.useFakeTimers();let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){calls++;throw error;}};
  await expect(collect(recoverIncludedLimits(provider))).rejects.toEqual(error);expect(calls).toBe(1);expect(vi.getTimerCount()).toBe(0);
});
it("supports older relay messages and HTTP-date Retry-After",async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);let calls=0;
  const provider:Provider={id:"tagflow",displayName:"Included AI",models:[],async *stream(){if(++calls===1)throw{status:429,message:"Included AI returned HTTP 429 (code rate-limit)",retryAfter:"Thu, 01 Jan 1970 00:00:02 GMT"};yield{kind:"stop",reason:"end-turn"};}};
  const result=collect(recoverIncludedLimits(provider));await vi.advanceTimersByTimeAsync(2000);await result;expect(calls).toBe(2);
});
