// Public synthetic development scenarios from the preceding pause experiment.
export const ENDPOINT_CASES=[
 {id:"complete",parts:["One mango lassi."],gapMs:0},
 {id:"quantity_pause",parts:["Two", "garlic naan, mild spice."],gapMs:600},
 {id:"modifier_pause",parts:["One fish pakora", "medium spice, please."],gapMs:700},
 {id:"second_item_pause",parts:["One rice", "and one mango lassi."],gapMs:1000},
 {id:"correction_pause",parts:["One garlic naan", "no, make it two, mild spice."],gapMs:600},
 {id:"filler_pause",parts:["Um, one chicken", "biryani, medium spice."],gapMs:800},
];
export function resampleEndpoint(pcm:Buffer){const input=new Int16Array(pcm.buffer,pcm.byteOffset,pcm.length/2);let start=0,end=input.length;while(start<end&&Math.abs(input[start])<40)start++;while(end>start&&Math.abs(input[end-1])<40)end--;start=Math.max(0,start-720);end=Math.min(input.length,end+720);const count=Math.floor((end-start)*2/3),out=Buffer.alloc(count*2);for(let i=0;i<count;i++){const pos=start+i*1.5,index=Math.floor(pos),fraction=pos-index;out.writeInt16LE(Math.round(input[index]*(1-fraction)+(input[Math.min(index+1,end-1)]??0)*fraction),i*2);}return out;}
