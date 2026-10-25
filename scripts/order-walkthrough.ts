// Public synthetic walkthrough, never a held-out case or a customer ticket.
import { writeFileSync } from "node:fs";
import { runTurn, newState } from "../lib/dialog";
let state=newState();const turns=[];
for(const text of ["one full chicken lahori karahi extra spicy notes no green onions","two garlic naan mild spice","one mango lassi","checkout","Demo Guest","yes"]){
 const result=runTurn(state,text);state=result.state;turns.push({caller:text,reply:result.reply});
 if(result.summary){writeFileSync("docs/order-walkthrough.json",JSON.stringify({kind:"synthetic-demo-order",turns,ticket:result.summary},null,2)+"\n");console.log(JSON.stringify({subtotalCents:result.summary.subtotalCents,lines:result.summary.items.length,status:result.summary.status}));}
}
if(state.phase!=="closed")throw Error("Walkthrough failed to complete local confirmation");
