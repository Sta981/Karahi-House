// A small, explicit ordering vocabulary, not a translator or an STT model.
// Unknown script is preserved and rejected before it can disappear in the
// ASCII matcher. Customer names/callbacks bypass this normalization.
const WORDS:Record<string,string>={
  "यही":"yahi","येही":"yehi","ऑर्डर":"order","आर्डर":"order","इतना":"itna","खत्म":"khatam","ख़त्म":"khatam","सही":"sahi",
  "یہی":"yahi","آرڈر":"order","ہے":"hai","ختم":"khatam","ہاں":"haan",
  "ਇਹੀ":"ehi","ਆਰਡਰ":"order","ਹੈ":"hai","ਖਤਮ":"khatam","ਹੋ":"ho","ਗਿਆ":"gaya","ਠੀਕ":"theek","ਹਾਂ":"haan",
  "एलर्जी":"allergy","الرجی":"allergy","ਐਲਰਜੀ":"allergy",
  "एक":"ek","दो":"do","तीन":"teen","चार":"chaar","पांच":"paanch","पाँच":"paanch","छह":"chay","सात":"saat","आठ":"aath","नौ":"nau","दस":"das",
  "मुझे":"mujhe","हमें":"hume","मैनू":"mainu","मैनु":"mainu","चाहिए":"chahiye","चाहिये":"chahiye","दे":"de","देना":"dena","दें":"dein","दीजिए":"dijiye",
  "हटा":"hata","हटाओ":"hatao","निकाल":"nikal","निकालो":"nikalo","कर":"kar","करो":"karo","मत":"mat","नहीं":"nahi","नही":"nahi","बस":"bas","और":"aur","हाँ":"haan","हां":"haan","जी":"ji",
  "कम":"kam","मिर्च":"mirch","मिर्ची":"mirchi","ज्यादा":"zyada","ज़्यादा":"zyada","बहुत":"bahut","बिल्कुल":"bilkul","बिना":"bina","तीखा":"teekha","आधा":"aadha","पूरा":"poora",
  "सब":"sab","सभी":"sab","दोनों":"dono","सिर्फ":"sirf","में":"mein","से":"se","का":"ka","की":"ki","है":"hai","हो":"ho","गया":"gaya","क्या":"kya","कुछ":"kuch","कितना":"kitna","कितने":"kitne","क्यों":"kyun",
  "चिकन":"chicken","लाहौरी":"lahori","लहोरी":"lahori","कराही":"karahi","कड़ाही":"karahi","कड़ाई":"kadai","व्हाइट":"white","वाइट":"white","शिनवारी":"shinwari",
  "बीफ":"beef","बकरा":"goat","लैम्ब":"lamb","मछली":"fish","फिश":"fish","पनीर":"paneer","टिक्का":"tikka","मसाला":"masala","बिरयानी":"biryani","पकोड़ा":"pakora","पकोरा":"pakora","कबाब":"kabab","सीख":"seekh",
  "नान":"naan","रोटी":"roti","चावल":"rice","रायता":"raita","दाल":"daal","आम":"mango","मैंगो":"mango","लस्सी":"lassi","लहसुन":"garlic","प्याज":"onion","प्याज़":"onion","मिठाई":"mithai","मेनू":"menu",
  "ایک":"aik","دو":"do","تین":"teen","چار":"chaar","مجھے":"mujhe","مینوں":"mainu","چاہیے":"chahiye","دیں":"dein","دے":"de","ہٹا":"hata","نکال":"nikal","نہیں":"nahi","مت":"mat",
  "دونوں":"dono","سب":"sab","اور":"aur","بس":"bas","کم":"kam","مرچ":"mirch","زیادہ":"zyada","آدھا":"aadha","پورا":"poora","چکن":"chicken","بریانی":"biryani","نان":"naan","لہسن":"garlic","آم":"mango","لسی":"lassi",
  "ਮੈਨੂੰ":"mainu","ਇੱਕ":"ikk","ਇਕ":"ik","ਦੋ":"do","ਤਿੰਨ":"tinn","ਚਾਰ":"chaar","ਦੇ":"de","ਦਿਓ":"deyo","ਕੱਢ":"kadd","ਨਹੀਂ":"nahi","ਦੋਵੇਂ":"dono","ਸਾਰੇ":"saare",
  "ਚਿਕਨ":"chicken","ਬਿਰਯਾਨੀ":"biryani","ਨਾਨ":"naan","ਅੱਧਾ":"aadha","ਪੂਰਾ":"poora","ਮਿਰਚ":"mirch","ਘੱਟ":"ghatt","ਵੱਧ":"wadh","ਹੋਰ":"hor","ਕੁਝ":"kujh","ਬੱਸ":"bas","ਲੱਸੀ":"lassi","ਅੰਬ":"mango",
};
export interface NormalizedTurn { text:string; changed:boolean; unsupportedScript:boolean }
export const romanKnownWord=(word:string):string|undefined=>Object.hasOwn(WORDS,word)?WORDS[word]:undefined;
export function normalizeCodeSwitch(raw:string,preserveIdentity=false):NormalizedTurn{
  if(preserveIdentity||/^(?:my name is|this is|i am|i'm|callback|call back|phone|contact|mobile)\b/i.test(raw.trim()))return {text:raw,changed:false,unsupportedScript:false};
  let text=raw.normalize("NFKC").replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u0A66-\u0A6F]/g,digit=>{
    const code=digit.charCodeAt(0),base=code>=0x0a66?0x0a66:code>=0x0966?0x0966:code>=0x06f0?0x06f0:0x0660;
    return String(code-base);
  }).replace(/[\p{L}\p{M}]+/gu,word=>romanKnownWord(word)??word);
  text=text.replace(/\b(?:mainu|mainoo|mennu|menuu)\b/gi,"mujhe")
    .replace(/\b(?:sirf|siraph)\b/gi,"only").replace(/\b(?:dono|donon|dovein|doven)\b/gi,"both")
    .replace(/\b(?:saare|saray|saary|sab|saarey)\b/gi,"all")
    .replace(/\b(?:bilkul\s+)?(?:bina|baghair)\s+mirch(?:i)?\b|\b(?:bilkul\s+)?mirch(?:i)?\s+(?:bilkul\s+)?(?:nahi|nahin|nai)\b|\b(?:teekha|tikha)\s+(?:nahi|nahin)\b/gi,"no spice")
    .replace(/\b(?:bohat|bahut|bohut)\s+(?:zyada\s+)?(?:teekha|tikha|mirch(?:i)?)\b/gi,"extra spicy")
    .replace(/\b(?:kam|ghatt|thori|thodi|halki)\s+mirch(?:i)?\b/gi,"mild spice")
    .replace(/\b(?:darmiyani|darmiana|medium)\s+mirch(?:i)?\b/gi,"medium spice")
    .replace(/\b(?:zyada|ziada|wadh|tez)\s+mirch(?:i)?\b/gi,"spicy")
    .replace(/\b(?:aadha|adha|addha|adhi)\b/gi,"half").replace(/\b(?:poora|pura|poori)\b/gi,"full");
  text=text.replace(/\b(?:aur\s+(?:kuch|kuchh)\s+(?:nahi|nahin)|hor\s+(?:kuch|kujh)\s+(?:nahi|nai)|bas\s+(?:itna(?:\s+hi)?|ho\s+gaya|ji))\b/gi,"that's all");
  if(/^(?:haan(?:\s+ji)?|han(?:\s+ji)?|hanji|ji\s+haan|theek\s+hai)[.!]?$/i.test(text.trim()))text="yes";
  if(/^(?:nahi|nhi|nahin|nai)(?:\s+ji)?[.!]?$/i.test(text.trim()))text="no";
  const command="(?:hata(?:o)?|nikal(?:o)?|kadd|kad|kadh)(?:\\s+(?:do|dein|dena|deo|deyo|diyo|dyo))?";
  const suffix=text.trim().match(new RegExp(`^(.+?)\\s+((?:(?:mat|na|nahi|nahin)\\s+)?${command})[.!]?$`,"i"));
  const prefix=text.trim().match(new RegExp(`^((?:(?:mat|na|nahi|nahin)\\s+)?${command})\\s+(.+?)[.!]?$`,"i"));
  if(suffix||prefix){
    const body=suffix?suffix[1]:prefix![2],action=suffix?suffix[2]:prefix![1];
    const negative=/\b(?:mat|nahi|nahin|na)\b/i.test(action)||/\b(?:mat|nahi|nahin|na)\s*$/i.test(body);
    let target=body.replace(/\b(?:mat|nahi|nahin|na)\s*$/i,"").trim();
    const part=target.match(/^(.+?)\s+(?:mein\s+se|me\s+se|vichon|vicho)\s+((?:only\s+)?(?:one|two|three|ek|aik|ik|ikk|do|teen|tinn|both|all|\d+))$/i);
    if(part)target=`${part[2]} ${part[1]}`;
    text=`${negative?"do not ":""}remove ${target}`;
  }
  if(/\b(?:kya(?:\s+kya)?\s+(?:hai|milta\s+hai)|ki\s+(?:hai|milda(?:\s+hai)?))\b/i.test(text)){
    text=`what do you have in ${text.replace(/\b(?:kya(?:\s+kya)?\s+(?:hai|milta\s+hai)|ki\s+(?:hai|milda(?:\s+hai)?))\b/gi,"")}`;
  }
  if(/\b(?:bill|total)\s+kitna\s+hai\b/i.test(text))text="what is the total";
  if(/\b(?:kyun|kyu|kyon)\b/i.test(text)&&!/\b(?:remove|change|replace)\b/i.test(text))text=`why ${text}`;
  return {text,changed:text!==raw,unsupportedScript:/[^\x00-\x7F]/.test(text.replace(/[^\p{L}\p{M}\p{N}]/gu,""))};
}
