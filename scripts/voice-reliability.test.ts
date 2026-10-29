import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { demoAccessCode } from "../voice/access";
import { recoverableVoiceError, sttCloseError, voiceErrorMessage } from "../voice/connection-status";
import { AuraWsTts } from "../voice/aura-ws";
import { VoiceSession } from "../voice/session";
import { AuraTts,makeTts } from "../voice/tts";

test("Aura uses explicit HTTP by default with no automatic provider fallback",()=>{
  const previous=process.env.VOICE_AURA_TRANSPORT;delete process.env.VOICE_AURA_TRANSPORT;
  try{assert.ok(makeTts("aura-2") instanceof AuraTts);assert.ok(makeTts("aura-2","ws") instanceof AuraWsTts);assert.throws(()=>makeTts("aura-2","unknown"));}
  finally{if(previous===undefined)delete process.env.VOICE_AURA_TRANSPORT;else process.env.VOICE_AURA_TRANSPORT=previous;}
});

test("loopback ignores hosted passwords while public binding still requires one",()=>{
  for(const host of ["127.0.0.1","localhost","::1"])assert.equal(demoAccessCode(host,"configured-but-local"),"");
  assert.throws(()=>demoAccessCode("0.0.0.0","short"));
  assert.equal(demoAccessCode("0.0.0.0","x".repeat(24)),"x".repeat(24));
});
test("recognition close diagnostics never echo raw provider payloads",()=>{
  const payload="NET-0001 unrelated private callback 5551234567";
  const error=sttCloseError(1011,payload);assert.equal(error.code,"stt_audio_timeout");assert.equal(error.closeCode,1011);
  assert.ok(!JSON.stringify(error).includes("5551234567"));assert.match(voiceErrorMessage(error.code),/microphone/i);
  assert.equal(sttCloseError(1008,"DATA-0000 private text").code,"stt_invalid_audio");
  assert.equal(recoverableVoiceError("tts_failed"),true);assert.equal(recoverableVoiceError("stt_disconnected"),false);
});
test("a synthesis failure preserves the order and allows the next spoken turn",async()=>{
  const events:any[]=[];let fail=true;
  const session=new VoiceSession({name:"fixture",warm:async()=>{},close(){},async *speak(){if(fail)throw Error("connection failed");yield Buffer.from([0,0]);}},event=>events.push(event));
  await session.turn("three rice");assert.equal(events.find(event=>event.code==="tts_failed").recoverable,true);
  fail=false;await session.turn("make it four");const reply=events.filter(event=>event.type==="reply").at(-1);
  assert.equal(reply.cart.length,1);assert.equal(reply.cart[0].qty,4);assert.ok(events.some(Buffer.isBuffer));session.close();
});
test("an old Aura socket closing cannot erase a newly opened connection",async()=>{
  const sockets:any[]=[];
  const tts=new AuraWsTts(()=>{
    const socket=Object.assign(new EventEmitter(),{readyState:Number(WebSocket.CONNECTING),close(this:EventEmitter & {readyState:number}){this.readyState=WebSocket.CLOSED;this.emit("close");},terminate(this:{close():void}){this.close();}});
    sockets.push(socket);queueMicrotask(()=>{socket.readyState=WebSocket.OPEN;socket.emit("open");});return socket as unknown as WebSocket;
  });
  try{await tts.warm();sockets[0].readyState=WebSocket.CLOSING;await tts.warm();sockets[0].emit("close");await tts.warm();assert.equal(sockets.length,2);}finally{tts.close();}
});
test("Aura closing during connection rejects promptly rather than hanging",async()=>{
  const tts=new AuraWsTts(()=>{
    const socket=Object.assign(new EventEmitter(),{readyState:WebSocket.CONNECTING});
    queueMicrotask(()=>socket.emit("close"));return socket as unknown as WebSocket;
  });
  await assert.rejects(tts.warm(),/closed before ready/);
});
test("Aura reconnects after an idle socket closes and produces the next reply",async()=>{
  const server=new WebSocketServer({port:0,host:"127.0.0.1"});await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address();if(!address||typeof address==="string")throw Error("No fixture port");let connections=0;
  server.on("connection",socket=>{connections++;socket.on("message",bytes=>{if(JSON.parse(bytes.toString()).type==="Flush"){socket.send(Buffer.from([1,0]));socket.send(JSON.stringify({type:"Flushed"}));}});});
  const tts=new AuraWsTts(()=>new WebSocket(`ws://127.0.0.1:${address.port}`));
  try{
    for await(const _chunk of tts.speak("A test reply.",new AbortController().signal)){}
    for(const socket of server.clients)socket.close();await new Promise(resolve=>setTimeout(resolve,40));
    const audio:Buffer[]=[];for await(const chunk of tts.speak("A later reply.",new AbortController().signal))audio.push(chunk);
    assert.deepEqual(Buffer.concat(audio),Buffer.from([1,0]));assert.equal(connections,2);
  }finally{tts.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("cancelling Aura after partial PCM rejects rather than certifying a complete clip",async()=>{
 const server=new WebSocketServer({port:0,host:"127.0.0.1"});await new Promise<void>(resolve=>server.once("listening",resolve));
 const address=server.address();if(!address||typeof address==="string")throw Error("No fixture port");
 server.on("connection",socket=>socket.on("message",bytes=>{const event=JSON.parse(bytes.toString());if(event.type==="Flush")socket.send(Buffer.from([1,0]));if(event.type==="Clear")socket.send(JSON.stringify({type:"Cleared"}));}));
 const tts=new AuraWsTts(()=>new WebSocket(`ws://127.0.0.1:${address.port}`)),abort=new AbortController();
 try{const iterator=tts.speak("Partial fixture.",abort.signal);assert.deepEqual((await iterator.next()).value,Buffer.from([1,0]));abort.abort();await assert.rejects(()=>iterator.next(),error=>(error as Error).name==="AbortError");}
 finally{tts.close();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
