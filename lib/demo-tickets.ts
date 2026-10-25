import {createHash} from "node:crypto";
import type {CallSummary} from "./dialog";
import {MENU,MODIFIERS,unitPriceCents} from "./menu";
import {safeTranscript} from "../voice/turn-log";
import type {DemoTicket} from "./demo-ticket-types";

const BY_NAME=new Map(MENU.map(item=>[item.name,item]));
const clean=(text:string)=>safeTranscript(text).replace(/[\r\n\t]/g," ").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email redacted]");
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
export function ticketText(ticket:DemoTicket):string{
 return ["DEMO — simulated order; not accepted by the restaurant",`Ticket: ${ticket.ticketId}`,`Status: ${ticket.status}`,`Name: ${ticket.customerName}`,`Callback: ${ticket.callback}`,"Pickup; payment at pickup",...ticket.items.map(item=>`${item.qty} ${item.name}${item.size?`, ${item.size}`:""}${item.spice?`, ${item.spice}`:""}${item.notes.length?`, notes: ${item.notes.join("; ")}`:""}: ${money(item.lineTotalCents)}${item.sizeVerified===false?" (size surcharge unverified)":""}`),`Subtotal: ${money(ticket.subtotalCents)}; tax not configured`,...ticket.notes.map(note=>`Note: ${note}`),`Build: ${ticket.sourceBuild}`,"Staff acceptance is not wired. No payment, booking or real SMS was made."].join("\n");
}
type Context={key:string;callbackProvided?:boolean;sourceBuild?:string;allowNotifications?:boolean};
type Options={env?:Record<string,string|undefined>;fetch?:typeof fetch;ttlMs?:number;maxTickets?:number};
type Entry={ticket:DemoTicket;settled:Promise<DemoTicket>;listeners:Set<(ticket:DemoTicket)=>void>;expires:ReturnType<typeof setTimeout>};
export class DemoTicketService {
 private entries=new Map<string,Entry>();
 constructor(private options:Options={}){}
 submit(summary:CallSummary,context:Context,publish?:(ticket:DemoTicket)=>void){
  if(summary.kind!=="order"||summary.status!=="pending_acceptance"||summary.demo!==true||!summary.items.length)throw Error("Only confirmed demo orders may create an order ticket");
  if(!context.key||context.key.length>256)throw Error("Invalid ticket identity");
  const key=createHash("sha256").update(context.key).digest("hex");
  const existing=this.entries.get(key);
  if(existing){if(publish){existing.listeners.add(publish);publish(structuredClone(existing.ticket));}return {ticket:structuredClone(existing.ticket),settled:existing.settled.then(()=>structuredClone(existing.ticket))};}
  const items=summary.items.map(line=>{
   const item=BY_NAME.get(line.name);if(!item||!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>50)throw Error("Invalid menu facts on ticket");
   if(item.size&&!['Half','Full'].includes(line.variant??""))throw Error("Missing ticket size");
   if(!item.size&&line.variant)throw Error("Unsupported ticket size");
   if(item.spice&&!MODIFIERS.spice_level.options.includes(line.spice??""))throw Error("Missing or invalid ticket spice");
   if(!item.spice&&line.spice)throw Error("Unsupported ticket spice");
   const cents=unitPriceCents(item,line.variant as "Half"|"Full"|undefined)*line.qty;
   if(cents!==line.lineTotalCents)throw Error("Ticket price differs from menu");
   return {name:item.name,qty:line.qty,size:line.variant,spice:line.spice,notes:line.notes.map(clean),lineTotalCents:cents,...(item.size?{sizeVerified:item.size_verified}:{})};
  });
  const subtotalCents=items.reduce((sum,item)=>sum+item.lineTotalCents,0);if(subtotalCents!==summary.subtotalCents)throw Error("Ticket subtotal differs from local prices");
  const env=this.options.env??process.env,enabled=env.DEMO_NOTIFICATIONS_ENABLED==="true"&&context.allowNotifications!==false;
  const ticket:DemoTicket={ticketId:`DEMO-${key.slice(0,24)}`,label:"DEMO",kind:"order",status:"pending_acceptance",demo:true,staffAccepted:false,menuApproved:summary.menuApproved,createdAt:new Date().toISOString(),sourceBuild:context.sourceBuild??"unknown",customerName:clean(summary.customerName??"Demo guest"),callback:context.callbackProvided?"[redacted]":"not provided",orderType:"pickup",payment:"at pickup",tax:"not configured",items,subtotalCents,notes:summary.notes.map(clean),email:{status:enabled?"not_configured":"disabled",provider:"resend"},sms:{status:enabled?"simulated":"disabled",sent:false,text:""}};
  ticket.sms.text=`DEMO — SIMULATED SMS; NOT SENT\n${ticketText(ticket)}`;
  const listeners=new Set<(ticket:DemoTicket)=>void>();if(publish)listeners.add(publish);
  const notify=()=>{for(const listener of listeners)try{listener(structuredClone(ticket));}catch{/* A closed browser cannot break a confirmed ticket. */}};
  const expires=setTimeout(()=>this.entries.delete(key),this.options.ttlMs??30*60*1000);expires.unref();
  const entry:Entry={ticket,listeners,expires,settled:Promise.resolve(ticket)};
  while(this.entries.size>=(this.options.maxTickets??100)){const oldest=this.entries.keys().next().value!;clearTimeout(this.entries.get(oldest)!.expires);this.entries.delete(oldest);}
  this.entries.set(key,entry);
  const recipient=env.DEMO_NOTIFICATION_EMAIL?.trim()??"",apiKey=env.RESEND_API_KEY?.trim()??"";
  if(enabled&&recipient&&apiKey&&/^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(recipient)){
   ticket.email.status="sending";
   // Resolve asynchronously: voice confirmation/playback never awaits email.
   entry.settled=Promise.resolve().then(async()=>{
    const signal=AbortSignal.timeout(5000);
    try{
     const response=await (this.options.fetch??fetch)("https://api.resend.com/emails",{method:"POST",signal,headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`demo-order/${key}`},body:JSON.stringify({from:"Karahi House DEMO <onboarding@resend.dev>",to:[recipient],subject:`[DEMO] pending_acceptance — ${ticket.ticketId}`,text:ticketText(ticket)})});
     // Provider acceptance is not inbox delivery or restaurant acceptance.
     ticket.email=response.ok?{status:"provider_accepted",provider:"resend"}:{status:"failed",provider:"resend",reason:"provider"};
     // Provider response bodies may contain recipient details; never log them.
     await response.body?.cancel().catch(()=>{});
    }catch{ticket.email={status:"failed",provider:"resend",reason:signal.aborted?"timeout":"network"};}
    notify();return structuredClone(ticket);
   });
  }else if(enabled)ticket.email.reason="configuration";
  notify();return {ticket:structuredClone(ticket),settled:entry.settled.then(()=>structuredClone(ticket))};
 }
 clear(){for(const entry of this.entries.values())clearTimeout(entry.expires);this.entries.clear();}
}
// In-memory only. No filesystem, audio, transcript or provider-body persistence.
const shared=globalThis as typeof globalThis&{karahiDemoTickets?:DemoTicketService};
export const demoTickets=shared.karahiDemoTickets??=new DemoTicketService();
