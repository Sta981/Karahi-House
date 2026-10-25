import type {IncomingMessage} from "node:http";
export const isLoopback=(host:string)=>["127.0.0.1","localhost","::1","[::1]","::ffff:127.0.0.1"].includes(host.toLowerCase());
// Forwarding headers only ESCALATE authentication; never use them to grant it.
export function directLocalRequest(request:Pick<IncomingMessage,"headers"|"socket">):boolean{
  let host="";try{host=new URL(`http://${request.headers.host??""}`).hostname;}catch{return false;}
  return isLoopback(host)&&isLoopback(request.socket.remoteAddress??"")&&!Object.keys(request.headers).some(name=>/^(?:forwarded|x-forwarded-|x-original-host|x-ngrok-)/i.test(name));
}
export function requiresVoiceToken(bindHost:string,request:Pick<IncomingMessage,"headers"|"socket">,force=false){return force||!isLoopback(bindHost)||!directLocalRequest(request);}
export function demoAccessCode(host: string, configured = "",publicRequest=false): string {
  if (isLoopback(host)&&!publicRequest) return "";
  const code = configured.trim();
  if (code.length < 24) throw Error("Public demo requires a private access code of at least twenty-four characters");
  return code;
}
export function validVoiceOrigin(request:Pick<IncomingMessage,"headers">):boolean{
 try{
  const origin=new URL(String(request.headers.origin??""));if(!["http:","https:"].includes(origin.protocol))return false;
  if(origin.host===request.headers.host)return true;
  // A tunnel can rewrite Host. This match still requires the token separately.
  return String(request.headers["x-forwarded-host"]??"").split(",").some(host=>host.trim()===origin.host);
 }catch{return false;}
}
