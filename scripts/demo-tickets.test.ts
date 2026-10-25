import test from "node:test";
import assert from "node:assert/strict";
import {DemoTicketService,demoTickets,ticketText} from "../lib/demo-tickets";
import {newState,runTurn,type CallSummary} from "../lib/dialog";
import {VoiceSession} from "../voice/session";
import {NextRequest} from "next/server";
import {POST} from "../app/api/agent/route";
const fixtureEnv={DEMO_NOTIFICATIONS_ENABLED:"true",RESEND_API_KEY:"fixture-key-not-a-real-credential",DEMO_NOTIFICATION_EMAIL:"owner@example.test"};
function confirmed():CallSummary{let state=newState(),summary:CallSummary|undefined;for(const text of ["two garlic naan mild spice and one mango lassi","checkout","Synthetic Guest","yes"]){const result=runTurn(state,text);state=result.state;summary=result.summary??summary;}assert.ok(summary);return summary;}
test("keys alone never send; explicit demo enablement is required",async()=>{
 let calls=0;const service=new DemoTicketService({env:{...fixtureEnv,DEMO_NOTIFICATIONS_ENABLED:""},fetch:async()=>{calls++;throw Error("must remain offline");}});
 try{const {ticket,settled}=service.submit(confirmed(),{key:"disabled"});await settled;assert.equal(calls,0);assert.equal(ticket.email.status,"disabled");assert.equal(ticket.sms.status,"disabled");assert.equal(ticket.sms.sent,false);assert.equal(ticket.status,"pending_acceptance");}finally{service.clear();}
});
test("missing credentials create a labelled simulated SMS without any carrier request",async()=>{
 const service=new DemoTicketService({env:{DEMO_NOTIFICATIONS_ENABLED:"true"}});
 try{const {ticket}=service.submit(confirmed(),{key:"missing"});assert.equal(ticket.email.status,"not_configured");assert.equal(ticket.sms.status,"simulated");assert.match(ticket.sms.text,/DEMO.*SIMULATED SMS; NOT SENT/);assert.match(ticket.sms.text,/pending_acceptance/);assert.equal(ticket.sms.sent,false);}finally{service.clear();}
});
test("one configured test inbox receives only local-priced redacted ticket facts; duplicate confirmation sends once",async()=>{
 const requests:any[]=[],updates:any[]=[],summary=confirmed();summary.customerName="call me 4155550199";summary.items[0].notes=["call back 4155550199","one two three four five six seven eight","no onions"];(summary as any).audio="PRIVATE_AUDIO";summary.transcriptHint="PRIVATE_TRANSCRIPT";
 const service=new DemoTicketService({env:fixtureEnv,fetch:async(url,init)=>{requests.push({url,init});return new Response('{"id":"fixture"}',{status:200});}});
 try{
  const first=service.submit(summary,{key:"same-order",callbackProvided:true},ticket=>updates.push(ticket));const duplicate=service.submit(summary,{key:"same-order",callbackProvided:true});
  const ticket=await first.settled;await duplicate.settled;assert.equal(requests.length,1);assert.equal(requests[0].url,"https://api.resend.com/emails");
  const body=JSON.parse(requests[0].init.body);assert.deepEqual(body.to,[fixtureEnv.DEMO_NOTIFICATION_EMAIL]);assert.equal(body.from,"Karahi House DEMO <onboarding@resend.dev>");assert.match(body.subject,/\[DEMO\].*pending_acceptance/);assert.match(requests[0].init.headers["Idempotency-Key"],/^demo-order\/[a-f0-9]{64}$/);
  assert.equal(ticket.subtotalCents,1248);assert.equal(ticket.callback,"[redacted]");assert.equal(ticket.email.status,"provider_accepted");assert.equal(ticket.staffAccepted,false);assert.equal(ticket.status,"pending_acceptance");
  const all=JSON.stringify([ticket,updates,body]);for(const sensitive of ["4155550199","one two three four five six seven eight","PRIVATE_AUDIO","PRIVATE_TRANSCRIPT",fixtureEnv.RESEND_API_KEY])assert.ok(!all.includes(sensitive),sensitive);
  assert.ok(body.text.includes("no onions"));assert.deepEqual(updates.map(row=>row.email.status),["sending","provider_accepted"]);
  first.ticket.items[0].qty=49;const replay=service.submit(summary,{key:"same-order"});assert.equal(replay.ticket.items[0].qty,2);
 }finally{service.clear();}
});
test("email rejection and network errors never become delivery or restaurant acceptance",async()=>{
 for(const failure of ["provider","network"]){let calls=0;const service=new DemoTicketService({env:fixtureEnv,fetch:async()=>{calls++;if(failure==="network")throw Error("secret provider error");return new Response("secret provider body",{status:503});}});
  try{const ticket=await service.submit(confirmed(),{key:failure}).settled;assert.equal(calls,1);assert.equal(ticket.email.status,"failed");assert.equal(ticket.email.reason,failure);assert.equal(ticket.status,"pending_acceptance");assert.equal(ticket.sms.status,"simulated");assert.ok(!JSON.stringify(ticket).includes("secret provider"));}finally{service.clear();}
 }
});
test("unconfirmed inquiries, modified menu prices and incomplete required choices cannot be mailed",()=>{
 const service=new DemoTicketService({env:fixtureEnv});
 try{for(const mutate of [(s:CallSummary)=>s.status="needs_review",(s:CallSummary)=>s.kind="catering",(s:CallSummary)=>s.items[0].lineTotalCents++,(s:CallSummary)=>s.subtotalCents++,(s:CallSummary)=>s.items[0].spice="hot"]){const summary=confirmed();mutate(summary);assert.throws(()=>service.submit(summary,{key:"invalid"}));}}finally{service.clear();}
});
test("ticket memory is capacity-bounded and expires instead of retaining old customer details",async()=>{
 const service=new DemoTicketService({env:{},maxTickets:1,ttlMs:10});
 try{const first=confirmed();first.customerName="First synthetic guest";service.submit(first,{key:"one"});service.submit(confirmed(),{key:"two"});first.customerName="Second synthetic guest";assert.equal(service.submit(first,{key:"one"}).ticket.customerName,"Second synthetic guest");await new Promise(resolve=>setTimeout(resolve,25));first.customerName="Third synthetic guest";assert.equal(service.submit(first,{key:"one"}).ticket.customerName,"Third synthetic guest");}finally{service.clear();}
});
test("voice sends only after explicit read-back confirmation and starts audio before slow email settles",async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let sent=0;
 const service=new DemoTicketService({env:fixtureEnv,fetch:async()=>{sent++;await gate;return new Response("{}",{status:200});}}),events:any[]=[];
 const session=new VoiceSession({name:"fixture",warm:async()=>{},close(){},async *speak(){yield Buffer.from([1,0]);}},event=>events.push(event),false,async(summary,callbackProvided,publish)=>{await service.submit(summary,{key:"voice-confirmed",callbackProvided},publish).settled;});
 try{for(const text of ["one mango lassi","checkout","Synthetic Guest"])await session.turn(text);assert.equal(sent,0);
  const from=events.length,turn=session.turn("yes");for(let i=0;i<10&&!events.slice(from).some(event=>event.type==="audio_start");i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent,1);assert.ok(events.slice(from).some(event=>event.type==="audio_start"));assert.ok(events.some(event=>event.type==="demo_ticket"&&event.ticket.email.status==="sending"));assert.ok(!events.some(event=>event.type==="call_end"));
  release();await turn;assert.ok(events.some(event=>event.type==="demo_ticket"&&event.ticket.email.status==="provider_accepted"));assert.equal(events.at(-1).type,"call_end");await session.turn("yes");assert.equal(sent,1);
 }finally{release();session.close();service.clear();}
});
test("text endpoint returns the same confirmed ticket on duplicate POSTs; recipient is never request-controlled",async()=>{
 const names=["DEMO_NOTIFICATIONS_ENABLED","RESEND_API_KEY","DEMO_NOTIFICATION_EMAIL"] as const,previous=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalFetch=globalThis.fetch;let calls=0;let sent:any;
 Object.assign(process.env,fixtureEnv);globalThis.fetch=async(_url,init)=>{calls++;sent=JSON.parse(String(init?.body));return new Response("{}",{status:200});};demoTickets.clear();
 try{let state:any=null,sessionCookie="",lastBody:any,finalInput:any;
  for(const text of ["one mango lassi","checkout","Synthetic Guest","yes"]){const requestBody={text,state,recipient:"not-the-owner@example.test"};if(text==="yes")finalInput=requestBody;
   const response=await POST(new NextRequest("http://127.0.0.1:3000/api/agent",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:3000",Cookie:sessionCookie},body:JSON.stringify(requestBody)}));lastBody=await response.json();state=lastBody.state;sessionCookie=`kh_demo_session=${response.cookies.get("kh_demo_session")!.value}`;
  }
  assert.equal(calls,1);assert.deepEqual(sent.to,[fixtureEnv.DEMO_NOTIFICATION_EMAIL]);assert.equal(lastBody.ticket.status,"pending_acceptance");assert.equal(lastBody.ticket.email.status,"provider_accepted");
  const retry=await POST(new NextRequest("http://127.0.0.1:3000/api/agent",{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://127.0.0.1:3000",Cookie:sessionCookie},body:JSON.stringify(finalInput)}));const duplicate=await retry.json();assert.equal(calls,1);assert.equal(duplicate.ticket.ticketId,lastBody.ticket.ticketId);assert.match(ticketText(duplicate.ticket),/DEMO/);
  const external=await POST(new NextRequest("http://127.0.0.1:3000/api/agent",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://unrelated.example.test",Cookie:"kh_demo_session=11111111-1111-1111-1111-111111111111"},body:JSON.stringify(finalInput)}));const blocked=await external.json();assert.equal(blocked.ticket.email.status,"disabled");assert.equal(calls,1);
 }finally{globalThis.fetch=originalFetch;demoTickets.clear();for(const name of names)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
});
