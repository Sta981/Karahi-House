import test from "node:test";
import assert from "node:assert/strict";
import {demoAccessCode,requiresVoiceToken,validVoiceOrigin} from "../voice/access";
const request=(host:string,headers:Record<string,string>={},remoteAddress="127.0.0.1")=>({headers:{host,origin:`http://${host}`,...headers},socket:{remoteAddress}} as any);
test("loopback binds permit only genuinely direct localhost calls without a token",()=>{
 assert.equal(requiresVoiceToken("127.0.0.1",request("127.0.0.1:3000")),false);
 assert.equal(requiresVoiceToken("127.0.0.1",request("localhost:3000")),false);
 for(const req of [request("demo.ngrok-free.app"),request("localhost:3000",{"x-forwarded-for":"198.51.100.10"}),request("localhost:3000",{forwarded:"for=198.51.100.10"}),request("localhost:3000",{},"192.0.2.10"),request("localhost.evil.invalid:3000")]){
  assert.equal(requiresVoiceToken("127.0.0.1",req),true);assert.throws(()=>demoAccessCode("127.0.0.1","",true));
 }
 assert.equal(requiresVoiceToken("0.0.0.0",request("localhost:3000")),true);
 assert.equal(requiresVoiceToken("127.0.0.1",request("localhost:3000"),true),true,"forced tunnel mode cannot be bypassed by rewritten headers");
});
test("token and origin checks remain independent through proxy host rewriting",()=>{
 const req=request("localhost:3000",{origin:"https://demo.ngrok-free.app","x-forwarded-host":"demo.ngrok-free.app"});
 assert.equal(validVoiceOrigin(req),true);assert.equal(requiresVoiceToken("127.0.0.1",req),true);
 assert.equal(demoAccessCode("127.0.0.1","x".repeat(24),true),"x".repeat(24));
 assert.equal(validVoiceOrigin(request("localhost:3000",{origin:"https://attacker.invalid"})),false);
 assert.equal(validVoiceOrigin(request("localhost:3000",{origin:"null"})),false);
});
