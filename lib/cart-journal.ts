import type { CartLine } from "./dialog";
export interface CartOperation { action:"add"|"remove"|"replace"; index:number; before?:CartLine; after?:CartLine }
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function recordCartOperations(before:CartLine[],after:CartLine[]):CartOperation[]{
  const operations:CartOperation[]=[];
  const length=Math.min(before.length,after.length);
  for(let index=0;index<length;index++)if(!equal(before[index],after[index]))operations.push({action:"replace",index,before:clone(before[index]),after:clone(after[index])});
  for(let index=before.length-1;index>=after.length;index--)operations.push({action:"remove",index,before:clone(before[index])});
  for(let index=before.length;index<after.length;index++)operations.push({action:"add",index,after:clone(after[index])});
  return operations;
}
export function replayCartOperations(initial:CartLine[],operations:CartOperation[]):CartLine[]{
  const cart=clone(initial);
  for(const operation of operations){
    const {index}=operation;
    if(!Number.isSafeInteger(index)||index<0)throw Error("Invalid operation target");
    if(operation.action==="add"){
      if(index!==cart.length||!operation.after)throw Error("Invalid append");cart.push(clone(operation.after));
    }else{
      if(index>=cart.length||!operation.before||!equal(cart[index],operation.before))throw Error("Stale operation target");
      if(operation.action==="remove")cart.splice(index,1);
      else if(operation.action==="replace"&&operation.after)cart[index]=clone(operation.after);
      else throw Error("Invalid operation");
    }
  }
  return cart;
}
export function rollbackCartOperations(current:CartLine[],operations:CartOperation[]):CartLine[]{
  const inverse=operations.toReversed().map((operation):CartOperation=>operation.action==="add"?{action:"remove",index:operation.index,before:operation.after}:operation.action==="remove"?{action:"add",index:operation.index,after:operation.before}:{action:"replace",index:operation.index,before:operation.after,after:operation.before});
  // Inverse removals can restore a line in the middle, unlike a normal append.
  let cart=clone(current);
  for(const operation of inverse){
    if(operation.action==="add"){
      if(!operation.after||operation.index>cart.length)throw Error("Invalid rollback insertion");cart.splice(operation.index,0,clone(operation.after));
    }else cart=replayCartOperations(cart,[operation]);
  }
  return cart;
}
