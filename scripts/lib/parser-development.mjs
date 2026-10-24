import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
export const cartView=cart=>cart.map(line=>({itemId:line.itemId,qty:line.qty,size:line.size??null,spice:line.spiceLevel??null}));
export function question(result){
 const s=result.state;
 return s.recognition?"item":s.pendingCorrection?"change":s.pending?"size":s.spiceClarification||s.phase==="ask_spice"?"spice":null;
}
export async function runDevelopment(api,cases){
 const rows=[];
 for(const row of cases){
  for(const expected of row.cart){
   const item=api.getItem(expected.itemId);if(!item)throw Error(`Invalid dev ID ${row.id}`);
   if(expected.size&&!item.size)throw Error(`Invalid dev size ${row.id}`);
   if(expected.spice&&!item.spice)throw Error(`Invalid dev spice ${row.id}`);
  }
  let state=api.newState();
  for(const text of row.seed)state=api.runTurn(state,text).state;
  const before=structuredClone(state.cart);
  const start=performance.now();
  const result=api.runTurn(state,row.text);
  const localMs=performance.now()-start;
  const actual={cart:cartView(result.state.cart),ask:question(result),kind:result.state.recognition?.issues[0]?.kind??(result.matches.length?"match":"ignore"),reply:result.reply};
  const cart=isDeepStrictEqual(row.cart,actual.cart);
  const actions=api.hasCorrectionMarkers(row.text)?api.segmentLocalCorrection(row.text).map(segment=>segment.action):[];
  const action=row.actions?isDeepStrictEqual(row.actions,actions):true;
  const asks=row.ask===actual.ask,kind=row.kind===actual.kind;
  const reply=(row.replyIncludes??[]).every(value=>actual.reply.toLowerCase().includes(value.toLowerCase()));
  const notes=!row.noteIncludes||result.state.cart.some(line=>line.notes.some(note=>note.includes(row.noteIncludes)));
  const totals=items=>items.reduce((sum,line)=>(sum[line.itemId]=(sum[line.itemId]??0)+line.qty,sum),{});
  const allowed=totals(row.cart),got=totals(actual.cart);
  const unsafe=Object.entries(got).some(([id,qty])=>qty>(allowed[id]??0));
  const replay=isDeepStrictEqual(api.replayCartOperations(before,result.operations),result.state.cart);
  rows.push({id:row.id,group:row.group,seed:row.seed,text:row.text,expected:{cart:row.cart,ask:row.ask,kind:row.kind,actions:row.actions},actual:{...actual,actions},cart,action,asks,kind,reply,notes,unsafe,replay,pass:cart&&action&&asks&&kind&&reply&&notes&&replay,localMs});
 }
 return rows;
}
export function percentiles(values){
 const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]??null;
 return {samples:sorted.length,p50:at(.5),p95:at(.95)};
}
export function summarizeDevelopment(rows){
 const count=key=>({correct:rows.filter(row=>row[key]).length,total:rows.length});
 return {scenarios:rows.length,pass:count("pass"),cart:count("cart"),actions:count("action"),questions:count("asks"),disposition:count("kind"),replay:count("replay"),unsafe:rows.filter(row=>row.unsafe).map(row=>row.id),latencyMs:percentiles(rows.map(row=>row.localMs)),misses:rows.filter(row=>!row.pass).map(row=>row.id)};
}
