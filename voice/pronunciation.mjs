// Speech-only hints, NOT menu aliases. No item/price/order mutation.
// Draft approximations for a native speaker to audition. Kokoro's English phone
// inventory cannot represent every Urdu consonant; these are not approved audio.
export const HINTS = {
  karahi: ["kuh-RAH-hee", "kəɹˈɑːhi"], lahori: ["luh-HOR-ee", "ləhˈɔːɹi"],
  shinwari: ["shin-WAH-ree", "ʃɪnwˈɑːɹi"], desi: ["DAY-see", "dˈeɪsi"],
  keema: ["KEE-muh", "kˈiːmə"], qeema: ["KEE-muh", "kˈiːmə"],
  seekh: ["seekh", "sˈiːk"], kabab: ["kuh-BAAB", "kəbˈɑːb"], kebab: ["kuh-BAAB", "kəbˈɑːb"],
  tikka: ["TIK-uh", "tˈɪkə"], masala: ["muh-SAA-luh", "məsˈɑːlə"],
  biryani: ["bir-YAA-nee", "bɪɹjˈɑːni"], tandoori: ["tun-DOOR-ee", "təndˈʊɹi"],
  paneer: ["puh-NEER", "pənˈɪɹ"], saag: ["saag", "sˈɑːɡ"],
  naan: ["naan", "nˈɑːn"], roti: ["ROH-tee", "ɹˈoʊti"],
  nihari: ["nih-HAA-ree", "nɪhˈɑːɹi"], haleem: ["huh-LEEM", "həlˈiːm"],
  korma: ["KOR-muh", "kˈɔːɹmə"], daal: ["daal", "dˈɑːl"], dal: ["daal", "dˈɑːl"],
  chana: ["CHUH-nuh", "tʃˈʌnə"], cholay: ["CHOH-lay", "tʃˈoʊleɪ"],
  bhindi: ["BHIN-dee", "bˈɪndi"], maghaz: ["MUH-ghuz", "mˈʌɡəz"],
  pakora: ["puh-KOR-uh", "pəkˈɔːɹə"], samosa: ["suh-MOH-suh", "səmˈoʊsə"],
  raita: ["RYE-tuh", "ɹˈaɪtə"], papad: ["PAA-pud", "pˈɑːpəd"],
  lassi: ["LUS-see", "lˈʌsi"], chai: ["chai", "tʃˈaɪ"],
  gulab: ["goo-LAAB", "ɡuːlˈɑːb"], jamun: ["JAA-moon", "dʒˈɑːmuːn"],
  rasmalai: ["rus-muh-LYE", "ɹəsməlˈaɪ"], kheer: ["kheer", "kˈɪɹ"],
  falooda: ["fuh-LOO-duh", "fəlˈuːdə"],
  malai: ["muh-LYE", "məlˈaɪ"], boti: ["BOH-tee", "bˈoʊti"], handi: ["HAAN-dee", "hˈɑːndi"],
  makhani: ["mukh-UH-nee", "məkˈɑːni"], aloo: ["AA-loo", "ˈɑːluː"], gobi: ["GOH-bee", "ɡˈoʊbi"],
  pulao: ["puh-LAA-oh", "pəlˈɑːoʊ"], papadam: ["PAA-puh-dum", "pˈɑːpədəm"],
  samosas: ["suh-MOH-suhz", "səmˈoʊsəz"], chutney: ["CHUT-nee", "tʃˈʌtni"],
};
export function pronunciationParts(text) {
  return text.split(/(\b[A-Za-z]+\b)/).filter(Boolean).map(text => ({ text, ipa: HINTS[text.toLowerCase()]?.[1] ?? null }));
}
export function auraPronunciation(text) {
  // Aura-2 inline pronunciation objects, as implemented by Pipecat's official
  // Deepgram service. Stress is immediately before the stressed vowel.
  return pronunciationParts(text).map(part => part.ipa ? "\\" + JSON.stringify({ word: part.text, pronounce: part.ipa.replace(/ˈ([bcdfɡhjklmnpɹstvwzʃʒθðŋ]+)/g, "$1ˈ") }).slice(0, -1) + "\\}" : part.text).join("");
}
export function auditionHint(text) {
  return text.replace(/\b[A-Za-z]+\b/g, word => HINTS[word.toLowerCase()]?.[0] ?? word);
}
export function splitSpeech(text, max = 140) {
  // Preserve every character/number; never truncate a long cart read-back.
  const chunks = []; let rest = text.trim();
  while (rest.length > max) {
    const prefix = rest.slice(0, max + 1);
    const sentence = [...prefix.matchAll(/[.!?;] (?=\S)/g)].at(-1)?.index;
    let cut = sentence === undefined ? prefix.lastIndexOf(" ") : sentence + 1;
    if (cut < 1) cut = max;
    chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest); return chunks;
}
