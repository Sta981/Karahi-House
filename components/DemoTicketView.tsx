"use client";
import type {DemoTicket} from "@/lib/demo-ticket-types";
export default function DemoTicketView({ticket}:{ticket:DemoTicket}){
 const email=ticket.email.status==="provider_accepted"?"Email accepted by provider; inbox delivery not verified.":ticket.email.status==="sending"?"Sending DEMO email…":ticket.email.status==="not_configured"?"DEMO email is not configured.":ticket.email.status==="failed"?"DEMO email failed. The ticket remains pending acceptance.":"DEMO email disabled.";
 return <section data-testid="demo-ticket" style={{marginTop:20}}><h2>DEMO ticket — pending staff acceptance</h2><p>{ticket.ticketId} · {ticket.status}</p><p>{email} SMS: {ticket.sms.status}; no text message was sent.</p><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(ticket,null,2)}</pre><button className="btn btn-ghost" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(ticket,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`${ticket.ticketId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download redacted DEMO ticket</button></section>;
}
