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
