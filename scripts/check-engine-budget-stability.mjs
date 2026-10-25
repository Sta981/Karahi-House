import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
const rows=[];
for(let run=1;run<=5;run++){
 let output,ok=true;try{output=execFileSync(process.execPath,["--import","tsx","--test","--test-reporter=tap","scripts/engine-bounds.test.ts"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch(error){output=String(error.stdout??"");ok=false;}
 const data=output.match(/# budget (\{[^\n]+\})/);
 rows.push({run,ok,...(data?JSON.parse(data[1]):{})});console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync("eval/results/engine-budget-stability.json",JSON.stringify({kind:"development-timing-gate-five-independent-processes",method:"median of seven interleaved batch medians; seven-word window-scaled relative bounds",rows,passed:rows.filter(row=>row.ok).length,total:rows.length},null,2)+"\n");
if(rows.some(row=>!row.ok))process.exitCode=1;
