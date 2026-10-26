import Sanscript from "@indic-transliteration/sanscript";
import {romanKnownWord} from "../lib/code-switch";

// Presentation only. NEVER send this approximate transliteration to menu
// matching or quantity parsing; the engine retains the actual STT words.
const scripts:[RegExp,string][]=[
 [/\p{Script=Devanagari}/u,"devanagari"],[/\p{Script=Gurmukhi}/u,"gurmukhi"],
 [/\p{Script=Arabic}/u,"urdu"],[/\p{Script=Bengali}/u,"bengali"],
 [/\p{Script=Gujarati}/u,"gujarati"],[/\p{Script=Tamil}/u,"tamil"],
 [/\p{Script=Telugu}/u,"telugu"],[/\p{Script=Kannada}/u,"kannada"],
 [/\p{Script=Malayalam}/u,"malayalam"],[/\p{Script=Sinhala}/u,"sinhala"],
];
export function romanTranscript(text:string):string{
 if(!/[^\x00-\x7f]/.test(text))return text;
 return text.normalize("NFKC").replace(/[\p{L}\p{M}\p{N}]+/gu,word=>{
  if(/^[\x00-\x7f]+$/.test(word))return word;
  const known=romanKnownWord(word);if(known)return known;
  const digits=word.replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u0A66-\u0A6F]/g,digit=>{const code=digit.charCodeAt(0);return String(code-(code>=0x0a66?0x0a66:code>=0x0966?0x0966:code>=0x06f0?0x06f0:0x0660));});
  if(/^\d+$/.test(digits))return digits;
  let converted=word;
  for(const [pattern,scheme]of scripts)if(pattern.test(converted)){
   try{converted=Sanscript.t(converted,scheme,"iast");}catch{return "[unrecognized word]";}
  }
  converted=converted.replace(/ś|ṣ/g,"sh").replace(/ṅ|ñ|ṇ/g,"n").normalize("NFKD").replace(/\p{M}/gu,"");
  return /[^\x00-\x7f]/.test(converted)?"[unrecognized word]":converted;
 }).replace(/[۔॥।]/g,".").replace(/[،]/g,",").replace(/[؟]/g,"?");
}
