import {Agent,request} from "node:https";
import {Readable} from "node:stream";
import {performance} from "node:perf_hooks";
import type {TtsObserver} from "./contracts";
export type AuraRequest=(url:URL,init:{signal:AbortSignal;body:string;headers:Record<string,string>},observe?:TtsObserver)=>Promise<Response>;
// Dedicated connection pool, reused across turns. No caller data or responses
// are cached. Idle TCP keep-alive is not an invented Aura KeepAlive message.
export class AuraHttpPool {
 private agent=new Agent({keepAlive:true,keepAliveMsecs:1000,maxSockets:2,maxFreeSockets:2,timeout:15000,scheduling:"lifo"});
 request:AuraRequest=(url,init,observe)=>new Promise((resolve,reject)=>{
  const start=performance.now(),req=request(url,{method:"POST",agent:this.agent,headers:{...init.headers,"Content-Length":Buffer.byteLength(init.body)},signal:init.signal},response=>{
   observe?.({type:"transport",atMs:performance.now()-start,reused:req.reusedSocket});
   const headers=new Headers();for(const [name,value]of Object.entries(response.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(", "):value);
   resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>,{status:response.statusCode??500,headers}));
  });
  req.on("socket",socket=>{socket.setNoDelay(true);socket.setKeepAlive(true,1000);if(!req.reusedSocket){socket.once("lookup",()=>observe?.({type:"transport",phase:"dns",atMs:performance.now()-start}));socket.once("connect",()=>observe?.({type:"transport",phase:"tcp",atMs:performance.now()-start}));socket.once("secureConnect",()=>observe?.({type:"transport",phase:"tls",atMs:performance.now()-start}));}});
  req.on("error",reject);req.end(init.body);
 });
 close(){this.agent.destroy();}
}
