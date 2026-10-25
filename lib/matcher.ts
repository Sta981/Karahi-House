import { MENU, MenuItem } from "./menu";
import { similarity, preparePhonetic, preparedSimilarity, similarityUpperBound, similarityAtLeast, PreparedPhonetic } from "./phonetic";
import POLICY from "./recognition-policy.json";
import { speechTokens, exactFullNameIds } from "./speech";

const STT_NUMBERS: Record<string, number> = POLICY.sttNumbers;
const DISTINCTIVE: Record<string, string[]> = POLICY.distinctiveTokens;
for (const id of [...Object.values(DISTINCTIVE).flat(), ...POLICY.nearMisses.flatMap(rule => rule.candidates)]) {
  if (!MENU.some(item => item.id === id)) throw new Error("Recognition policy must reference final-menu IDs only");
}

export interface Match {
  itemId: string;
  name: string;
  heard: string; // the words from the transcript that matched
  score: number; // 0..1
  start: number; // token index in the utterance
  end: number; // exclusive
  qty: number;
  portion?: "half" | "full";
  protein?: string;
  quantityExplicit?: boolean;
  quantityHeard?: string;
  quantityUncertain?: boolean;
  distinctiveToken?: string;
  requiresConfirmation?: boolean;
  alternatives?: { itemId: string; score: number }[];
  spiceLevel?: string;
  spiceAmbiguous?: boolean;
  notes?: string[];
}

interface VocabEntry {
  itemId: string;
  phrase: string;
  tokenCount: number;
  joined: string;
  tokens: string[];
  normalizedPhrase: string;
  prepared: PreparedPhonetic;
}

// Module-scoped indexes contain only immutable menu data, never caller text.
const MENU_BY_ID = new Map(MENU.map(item => [item.id, item]));
const MENU_TOKENS = new Map(MENU.map(item => [item.id, tokenize(item.name)]));
const RETRIEVAL_LABELS = new Map(MENU.map(item => [item,
  [item.name, ...item.aliases].map(label => preparePhonetic(tokenize(label).join("")))]));

const STOPWORDS = new Set([
  "a", "an", "the", "some", "of", "please", "plz", "and", "with", "for", "me",
  "i", "want", "need", "take", "would", "like", "get", "have", "can", "you", "give", "also",
  "add", "order", "one", "just", "to", "my", "us", "we", "that", "thats",
  "this", "these", "those", "it", "its", "all", "everything", "something",
  "anything", "else", "is", "was", "be",
  // Urdu/Hindi filler that shows up in code-switched orders
  "ka", "ki", "ke", "ko", "hai", "hain", "wala", "wali", "walay", "mujhe",
  "muje", "hume", "humein", "zara", "sa", "se", "mein", "may", "aur", "bhi",
  "kitne", "kitna", "kitni", "chahiye", "dena", "karo", "kar", "do", "ji",
  "haan", "han", "acha", "accha", "theek", "bas",
]);

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, couple: 2, few: 3,
  dozen: 12, single: 1, double: 2, triple: 3, zero: 0,
  // Urdu / Hindi numerals; callers mix languages mid-sentence
  ek: 1, aik: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5,
  che: 6, chay: 6, saat: 7, aath: 8, nau: 9, das: 10,
};

const PORTION_WORDS: Record<string, "half" | "full"> = {
  half: "half", haf: "half", adha: "half", aadha: "half", adhi: "half",
  full: "full", pura: "full", poora: "full", complete: "full",
};

const PROTEIN_WORDS: Record<string, string> = {
  goat: "Goat", bakra: "Goat", bakray: "Goat",
  lamb: "Lamb", beef: "Beef", chicken: "Chicken", murgh: "Chicken",
  murgi: "Chicken", murghi: "Chicken", paneer: "Paneer",
};

// Conjunctions that separate one ordered item from the next; quantity and
// portion words don't apply across them.
const BOUNDARY = new Set(["and", "aur", "plus", "also", "then", "with"]);

// Scan the nearest quantity once: an earlier article must not overwrite
// "a dozen" or "a couple". Never reach through another matched item.
function quantityBefore(tokens: string[], start: number, used: boolean[] = []): number | undefined {
  for (let i = start - 1; i >= Math.max(0, start - 6); i--) {
    const token = tokens[i];
    if (BOUNDARY.has(token) || used[i]) break;
    if (!(token in NUM_WORDS) && !/^\d+$/.test(token)) continue;
    if (token === "do") {
      const before = tokens[i - 1];
      const after = tokens[i + 1];
      const urduContext = tokens.slice(Math.max(0, i - 3), i).some((word) => ["mujhe", "muje", "hume", "humein"].includes(word));
      if (["you", "we", "they", "i", "the", "a", "an", "not"].includes(after)) continue;
      if (!(i === 0 || BOUNDARY.has(before) || urduContext)) continue;
    }
    if (token === "dozen") {
      const previous = tokens[i - 1];
      const multiplier = previous === "half" ? 0.5 : NUM_WORDS[previous] ?? (/^\d+$/.test(previous ?? "") ? Number(previous) : 1);
      return multiplier * 12;
    }
    return NUM_WORDS[token] ?? Number(token);
  }
  return undefined;
}

// Homophones are not global number words: only the token immediately before a
// retrieved dish may supply one. Ordinary prepositional/verb contexts are held
// out, and nothing scans past a conjunction or another dish to find one.
function sttQuantityBefore(tokens: string[], start: number, used: boolean[] = []): { qty: number; heard: string } | undefined {
  const heard = tokens[start - 1];
  if (!Object.hasOwn(STT_NUMBERS, heard) || used[start - 1]) return;
  const before = tokens[start - 2];
  if (heard === "to" && ["going","go","come","came","plan","talk","speak","listen","welcome","sent","send","deliver","next"].includes(before)) return;
  if (heard === "for" && ["waiting","wait","looking","look","thanks","thank","here","ready","pay","paid","payment","asking","ask","come","came","call","calling","sorry"].includes(before)) return;
  if (["ate","won"].includes(heard) && ["i","we","you","he","she","they","already","just","have","had"].includes(before)) return;
  return { qty: STT_NUMBERS[heard], heard };
}

// Fuzzy lookup for protein/portion words, so "chikan"/"chiken" still count as
// chicken and "haaf" counts as half.
const FUZZY_KEYS = new WeakMap<object, {key: string; prepared: PreparedPhonetic}[]>();
function fuzzyKey<T>(token: string, table: Record<string, T>): T | undefined {
  if (token in table) return table[token];
  // never fuzzy-match filler words ("get" and "goat" share a phonetic skeleton)
  if (token.length < 3 || STOPWORDS.has(token)) return undefined;
  let best: T | undefined;
  let bestScore = 0.84;
  let keys = FUZZY_KEYS.get(table);
  if (!keys) { keys = Object.keys(table).map(key => ({key, prepared: preparePhonetic(key)})); FUZZY_KEYS.set(table, keys); }
  const prepared = preparePhonetic(token);
  for (const {key, prepared: other} of keys) {
    if (Math.abs(key.length - token.length) > 2) continue;
    const s = preparedSimilarity(prepared, other);
    if (s >= bestScore) {
      bestScore = s;
      best = table[key];
    }
  }
  return best;
}

function tokenize(text: string): string[] {
  return speechTokens(text);
}

export function extractQuantityHint(text: string): number | undefined {
  const tokens = tokenize(text);
  return quantityBefore(tokens, tokens.length);
}

// Build the vocabulary once: every item name + alias, tokenized.
// Conjunctions are stripped from both sides of the comparison ("fish and
// chips" and "fish chips" should look identical).
const VOCAB: VocabEntry[] = [];
for (const item of MENU) {
  const phrases = new Set<string>([item.name.toLowerCase(), ...(item.website_name ? [item.website_name] : []), ...item.aliases]);
  for (const p of phrases) {
    const toks = tokenize(p).filter((t) => !BOUNDARY.has(t));
    if (!toks.length) continue;
    VOCAB.push({
      itemId: item.id,
      phrase: p,
      tokenCount: toks.length,
      joined: toks.join(""),
      tokens: toks,
      normalizedPhrase: tokenize(p).join(" "),
      prepared: preparePhonetic(toks.join("")),
    });
  }
}
// Filter, rather than concatenate buckets: preserve the original vocabulary
// insertion order for score ties and all existing clarification decisions.
const VOCAB_BY_LENGTH = new Map(Array.from({length: 7}, (_, index) => [index + 1,
  VOCAB.filter(entry => Math.abs(entry.tokenCount - (index + 1)) <= 1)]));
const MULTIWORD_STARTS = new Set(VOCAB.filter(entry => entry.tokenCount > 1).map(entry => entry.tokens[0]));
// Keys contain lengths only; values contain immutable menu entries, no caller text.
const LENGTH_COHORTS=new Map<string,VocabEntry[]>();
function vocabularyCohort(length:number,query:PreparedPhonetic):VocabEntry[]{
 const key=`${length}:${query.code.length}:${query.normalized.length}`;let entries=LENGTH_COHORTS.get(key);if(entries)return entries;
 entries=(VOCAB_BY_LENGTH.get(length)??[]).filter(entry=>{
  const pmax=Math.max(query.code.length,entry.prepared.code.length),rmax=Math.max(query.normalized.length,entry.prepared.normalized.length);
  const upper=(pmax ? .72*(1-Math.abs(query.code.length-entry.prepared.code.length)/pmax) : 0)+(rmax ? .28*(1-Math.abs(query.normalized.length-entry.prepared.normalized.length)/rmax) : 0);
  const threshold=Math.max(entry.tokenCount===length ? (length===1 ? .8 : .76) : .78,query.code.length<3 ? .9 : 0);
  return upper+1e-12>=threshold;
 });
 if(LENGTH_COHORTS.size>=2048)LENGTH_COHORTS.clear();LENGTH_COHORTS.set(key,entries);return entries;
}

// Single generic words that must never match an item on their own;
// they are disambiguated by the dialog layer instead.
const GENERIC_SOLO = new Set([
  "chicken", "lamb", "goat", "beef", "fish", "mutton", "veg", "vegetable",
  "masala", "curry", "special", "food", "meat", "kids",
]);



export function matchUtterance(text: string): Match[] {
  const originalTokens = tokenize(text);
  // A narrow, auditable observed STT repair, not a general phonetic rule.
  // Preserve the heard words and require dialog confirmation before adding it.
  const tokens = originalTokens.map((token, index) =>
    token === "kirby" && fuzzyKey(originalTokens[index - 1] ?? "", PROTEIN_WORDS) === "Chicken" ? "karahi" : token);
  if (!tokens.length) return [];

  const candidates: Match[] = [];

  for (let start = 0; start < tokens.length; start++) {
    if (STOPWORDS.has(tokens[start]) || tokens[start] in NUM_WORDS) {
      // windows never start on pure filler
      if (!(tokens[start] in PROTEIN_WORDS) && !MULTIWORD_STARTS.has(tokens[start])) continue;
    }
    for (let len = 1; len <= 7 && start + len <= tokens.length; len++) {
      const rawWindow = tokens.slice(start, start + len);
      // a window never ends on a conjunction or filler word (that shape is
      // just a shorter window), but may extend past one ("fish and chips"
      // stays matchable; the conjunction is filtered out of the comparison)
      const last = rawWindow[rawWindow.length - 1];
      if (BOUNDARY.has(last) || STOPWORDS.has(last)) continue;
      const windowTokens = rawWindow.filter((t) => !BOUNDARY.has(t));
      if (!windowTokens.length) continue;
      const effLen = windowTokens.length;
      const joined = windowTokens.join("");
      if (joined.length < 3) continue;
      if (effLen === 1 && (GENERIC_SOLO.has(windowTokens[0]) || fuzzyKey(windowTokens[0], PROTEIN_WORDS))) continue;
      // very short phonetic codes carry little signal; demand near-exactness
      const prepared = preparePhonetic(joined);
      const codeLen = prepared.code.length;
      const normalizedWindow = rawWindow.join(" ");
      const boundaries = rawWindow.filter(token => BOUNDARY.has(token));
      const numberSlots = windowTokens.flatMap((token,index) => token in NUM_WORDS || /^\d+$/.test(token) ? [{token,index}] : []);

      for (const entry of vocabularyCohort(effLen,prepared)) {
        // A quantity cannot be absorbed into an adjacent dish's longer span.
        // Numbers that are actually in a dish alias (Chicken 65, platter for 4)
        // remain matchable, at their explicit position in that alias.
        if (numberSlots.some(({token,index}) => entry.tokens[index] !== token)) continue;
        // only compare windows of similar length to the phrase
        // One-word vocabulary entries are exact-only. A misspelling must never
        // become permission to add a one-word menu item through phonetics.
        if(entry.tokenCount===1&&joined!==entry.joined)continue;
        // The original conjunction rule requires score===1. Reject impossible
        // spans before doing distances; keep the rule and accepted scores exact.
        if(boundaries.length&&
          !(prepared.normalized===entry.prepared.normalized&&(normalizedWindow===entry.normalizedPhrase||entry.phrase.includes("&")&&boundaries.every(token=>token==="and"))))continue;
        let threshold = entry.tokenCount === effLen ? (effLen === 1 ? 0.8 : 0.76) : 0.78;
        if (codeLen < 3) threshold = Math.max(threshold, 0.9);
        if (similarityUpperBound(prepared, entry.prepared) < threshold) continue;
        const s = similarityAtLeast(prepared, entry.prepared,threshold);
        if (s >= threshold) {
          candidates.push({
            itemId: entry.itemId,
            name: MENU_BY_ID.get(entry.itemId)!.name,
            heard: originalTokens.slice(start, start + len).filter((token) => !BOUNDARY.has(token)).join(" "),
            score: s,
            start,
            end: start + len,
            qty: 1,
            ...(originalTokens.slice(start, start + len).some((token, offset) => token !== tokens[start + offset])
              ? { requiresConfirmation: true } : {}),
          });
        }
      }
    }
  }

  // A distinctive token retrieves candidates, never permission to add. Prefer
  // an exact complete multiword name; noisy/truncated mentions require a yes
  // or a named choice even for one-word canonical names such as Kheer.
  for (let start = 0; start < tokens.length; start++) {
    const ids = DISTINCTIVE[tokens[start]];
    if (!ids || candidates.some(candidate => candidate.score === 1 && candidate.start <= start && candidate.end > start &&
      (candidate.end-candidate.start>1||exactFullNameIds(tokens[start]).includes(candidate.itemId)))) continue;
    for (const itemId of ids) candidates.push({ itemId, name: MENU_BY_ID.get(itemId)!.name,
      heard: originalTokens[start], start, end: start + 1, score: 0.9, qty: 1,
      requiresConfirmation: true, distinctiveToken: tokens[start] });
  }

  // Greedy selection: highest score first, longer spans win ties, no overlaps.
  candidates.sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start));
  const chosen: Match[] = [];
  const used = new Array(tokens.length).fill(false);
  for (const c of candidates) {
    let overlaps = false;
    for (let i = c.start; i < c.end; i++) if (used[i]) overlaps = true;
    if (overlaps) continue;
    // don't add the same item twice from one utterance unless spans differ a lot
    if (chosen.some((x) => x.itemId === c.itemId && Math.abs(x.start - c.start) < 2)) continue;
    for (let i = c.start; i < c.end; i++) used[i] = true;
    chosen.push(c);
  }

  // Attach quantity / portion / protein from neighboring tokens
  // (never reaching across "and"/"aur" into another item's words).
  for (const m of chosen) {
    const quantity = quantityBefore(tokens, m.start, used);
    if (quantity !== undefined) {
      m.qty = quantity;
      m.quantityExplicit = true;
    }
    const repairedQuantity = sttQuantityBefore(tokens, m.start, used);
    if (repairedQuantity) {
      m.quantityUncertain = quantity !== undefined && quantity !== repairedQuantity.qty;
      m.qty = repairedQuantity.qty;
      m.quantityExplicit = true;
      m.quantityHeard = repairedQuantity.heard;
    }
    if (m.end - m.start === 1 && DISTINCTIVE[tokens[m.start]]?.includes(m.itemId) && !exactFullNameIds(tokens[m.start]).includes(m.itemId)) {
      m.distinctiveToken = tokens[m.start];
      m.requiresConfirmation = true;
    }
    for (let i = m.start - 1; i >= Math.max(0, m.start - 3); i--) {
      const t = tokens[i];
      if (BOUNDARY.has(t)) break;
      if (used[i]) continue;
      const portion = fuzzyKey(t, PORTION_WORDS);
      if (portion) m.portion = portion;
      const protein = fuzzyKey(t, PROTEIN_WORDS);
      if (protein) m.protein = protein;
    }
    for (let i = m.end; i < Math.min(tokens.length, m.end + 3); i++) {
      const t = tokens[i];
      if (BOUNDARY.has(t)) break;
      if (used[i]) continue;
      const portion = fuzzyKey(t, PORTION_WORDS);
      if (portion) m.portion = portion;
      const protein = fuzzyKey(t, PROTEIN_WORDS);
      if (protein) m.protein ??= protein;
    }
    // protein/portion mentioned inside the heard span ("chikan karahi")
    for (const t of tokenize(m.heard)) {
      const protein = fuzzyKey(t, PROTEIN_WORDS);
      if (protein) m.protein ??= protein;
      // Dish words must not turn into invented sizes through phonetic similarity.
      const portion = PORTION_WORDS[t];
      if (portion) m.portion ??= portion;
    }
  }

  // Compare distinct identities; nearby scores must be clarified.
  for (const m of chosen) {
    // Compare distinct dishes covering the entire selected span. A short exact
    // generic alias ("naan") must not suppress a longer near match ("garlik
    // naan"). Shorter generic alternatives cannot undermine an exact full name.
    const rivals = new Map<string, number>();
    for (const candidate of candidates) {
      if (candidate.start > m.start || candidate.end < m.end) continue;
      if (tokens.slice(candidate.start, candidate.end).some((token) => BOUNDARY.has(token))) continue;
      if (chosen.some((other) => other !== m && candidate.start < other.end && other.start < candidate.end)) continue;
      const id = candidate.itemId;
      if (id === m.itemId || candidate.score < m.score - 0.06) continue;
      rivals.set(id, Math.max(rivals.get(id) ?? 0, candidate.score));
    }
    if (rivals.size) {
      m.alternatives = [{ itemId: m.itemId, score: m.score },
        ...[...rivals].sort((a, b) => b[1] - a[1]).map(([itemId, score]) => ({ itemId, score }))].slice(0, 3);
      m.requiresConfirmation = true;
    } else if (m.score < 0.9) {
      m.requiresConfirmation = true;
    }
  }

  chosen.sort((a, b) => a.start - b.start);
  return chosen;
}

export interface RecognitionIssue {
  kind: "clarify" | "unavailable";
  reason: "ambiguous" | "stt_repair" | "not_on_menu" | "quantity" | "low_margin" | "low_confidence" | "unsupported_size" | "distinctive_token";
  heard: string;
  start: number;
  end: number;
  candidates: Match[];
  question: string;
}

export interface RecognitionAnalysis {
  matches: Match[];
  issues: RecognitionIssue[];
}

const STYLE_RULES=[
  {words:["lahori"],label:"lahori"},{words:["shinwari"],label:"shinwari"},{words:["shinvari"],label:"shinwari"},
  {words:["white"],label:"white"},{words:["black","pepper"],label:"black pepper"},{words:["kali","mirch"],label:"black pepper"},{words:["keema"],label:"keema"},
].map(rule=>({...rule,items:MENU.filter(item=>item.name.toLowerCase().includes(rule.label)&&(/karahi/i.test(item.name)||rule.label==="keema"&&/naan/i.test(item.name)))}));
export function candidateQuestion(candidates:Match[]):string{
  const items=candidates.map(candidate=>MENU_BY_ID.get(candidate.itemId)!);
  if(items.length===1)return `Did you mean ${items[0].name}?`;
  const proteins=["Chicken","Lamb","Goat","Beef","Fish","Shrimp","Paneer"].filter(protein=>items.some(item=>item.protein===protein));
  if(proteins.length>1&&items.every(item=>item.protein))return `${proteins.slice(0,-1).join(", ")} or ${proteins.at(-1)}?`;
  if(items.some(item=>/keema naan/i.test(item.name))&&items.some(item=>/keema karahi/i.test(item.name)))return "Keema Karahi or Keema Naan?";
  return "Which style or protein would you like?";
}
function shortFamily(tokens:string[]):RecognitionAnalysis|undefined{
  const rule=STYLE_RULES.find(rule=>rule.words.every(word=>tokens.includes(word)));
  if(!rule)return;
  const allowed=new Set([...rule.words,"karahi","kadai","kadhai","kadahi",...Object.keys(PROTEIN_WORDS),...Object.keys(PORTION_WORDS)]);
  if(tokens.some(token=>!allowed.has(token)&&!STOPWORDS.has(token)&&!(token in NUM_WORDS)&&!(token in STT_NUMBERS)&&!/^\d+$/.test(token)))return;
  const protein=extractVariantHints(tokens.join(" ")).protein;
  const items=rule.items.filter(item=>(!protein||item.protein===protein)&&(!tokens.some(token=>/^(?:karahi|kadai|kadhai|kadahi)$/.test(token))||/karahi/i.test(item.name)));
  if(!items.length)return;
  const food=tokens.filter(token=>!STOPWORDS.has(token)&&!(token in NUM_WORDS)&&!(token in PORTION_WORDS)&&!(token in STT_NUMBERS)&&!/^\d+$/.test(token)).join(" ");
  if(exactFullNameIds(food).length===1)return;
  const start=Math.max(0,tokens.findIndex(token=>allowed.has(token))),end=tokens.length;
  const repaired=sttQuantityBefore(tokens,start),qty=repaired?.qty??quantityBefore(tokens,start)??1,hints=extractVariantHints(tokens.join(" "));
  const candidates:Match[]=items.map(item=>({itemId:item.id,name:item.name,qty,protein:item.protein,...hints,heard:tokens.join(" "),start,end,score:0,quantityExplicit:qty!==1||quantityBefore(tokens,start)!==undefined,...(repaired?{quantityHeard:repaired.heard}:{})}));
  return {matches:[],issues:[{kind:"clarify",reason:"ambiguous",heard:tokens.join(" "),start:0,end,candidates,question:candidateQuestion(candidates)}]};
}

// Candidate retrieval and permission to add an item are separate decisions.
// Unknown-food coverage is deliberately finite; an unrecognized request must
// still fall back to asking the caller, never inventing a menu entry.
export function analyzeUtterance(text: string): RecognitionAnalysis {
  const tokens = tokenize(text);
  const family=shortFamily(tokens);if(family)return family;
  const joined = tokens.join(" ");
  const matches = matchUtterance(text);
  const issues: RecognitionIssue[] = [];
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

  function context(start: number, end: number): string[] {
    let left = start;
    let right = end;
    while (left > Math.max(0, start - 5) && !BOUNDARY.has(tokens[left - 1])) left--;
    while (right < Math.min(tokens.length, end + 3) && !BOUNDARY.has(tokens[right])) right++;
    return tokens.slice(left, right);
  }

  function add(kind: RecognitionIssue["kind"], reason: RecognitionIssue["reason"], start: number, end: number, ids: string[], question: string) {
    if (issues.some((issue) => overlaps(issue, { start, end }))) return;
    const used = tokens.map((_, index) => matches.some((match) => !overlaps(match, { start, end }) && index >= match.start && index < match.end));
    const repairedQuantity = sttQuantityBefore(tokens, start, used);
    const covered = matches.find(match => overlaps(match, { start, end }) && match.quantityHeard);
    const quantity = repairedQuantity?.qty ?? covered?.qty ?? quantityBefore(tokens, start, used);
    const quantityHeard = repairedQuantity?.heard ?? covered?.quantityHeard;
    const hints = extractVariantHints(context(start, end).join(" "));
    const candidates = ids.map((id): Match => {
      const item = MENU_BY_ID.get(id);
      if (!item) throw new Error("Recognition policy references an absent menu ID");
      return {
        itemId: item.id, name: item.name, heard: tokens.slice(start, end).join(" "),
        start, end, score: 0, qty: quantity ?? 1,
        ...hints,
        ...(quantity !== undefined ? { quantityExplicit: true } : {}),
        ...(quantityHeard ? { quantityHeard } : {}),
        ...(PROTEIN_WORDS[MENU_TOKENS.get(item.id)![0]] ? { protein: PROTEIN_WORDS[MENU_TOKENS.get(item.id)![0]] } : {}),
      };
    });
    issues.push({ kind, reason, heard: tokens.slice(start, end).join(" "), start, end, candidates,
      question });
  }

  function find(pattern: RegExp, apply: (start: number, end: number) => void) {
    for (const found of joined.matchAll(pattern)) {
      const start = tokenize(joined.slice(0, found.index)).length;
      apply(start, start + tokenize(found[0]).length);
    }
  }

  // Family choices come exclusively from the current source, not old IDs.
  const idsFor = (predicate: (item: MenuItem) => boolean) => MENU.filter(predicate).map(item => item.id);
  const hasExact = (start: number, end: number) => matches.some(match => match.start <= start && match.end >= end && match.score === 1);
  function clarify(start: number, end: number, ids: string[], question: string) {
    if (ids.length) add("clarify", "ambiguous", start, end, ids, question);
  }
  find(/\b(?:karahi|kadai|kadhai|kadahi|kirby)\b/g, (start, end) => {
    if (hasExact(start, end)) return;
    const nearby = context(start, end).join(" ");
    const protein = extractVariantHints(nearby).protein;
    const styles = ["lahori", "white", "shinwari", "shinvari", "pepper", "kali mirch", "keema"];
    const style = styles.find(word => nearby.includes(word));
    const ids = idsFor(item => /karahi/i.test(item.name) && (!/\bmutton\b/.test(nearby) || ["Goat","Lamb"].includes(item.protein ?? "")) &&
      (!protein || item.protein === protein || new RegExp('^'+protein+'\\b','i').test(item.name)) &&
      (!style || item.name.toLowerCase().includes(style === "shinvari" ? "shinwari" : style === "kali mirch" ? "black pepper" : style)));
    clarify(start, end, ids, "Which protein and karahi style would you like?");
  });
  find(/\b(?:lahori|white|shinwari|shinvari|black pepper|kali mirch)\s+(?:karahi|kadai|kadhai)\b/g, (start, end) => {
    if (hasExact(start, end)) return;
    const style = tokens[start] === "shinvari" ? "shinwari" : tokens[start] === "kali" ? "black pepper" : tokens[start];
    clarify(start, end, idsFor(item => (item.family ?? "").toLowerCase().includes(style)), "Which protein would you like for that karahi?");
  });
  find(/\b(?:seekh|seek|sikh|sick)\s+(?:kebab|kabab|kabob|cabob)s?\b/g, (start, end) => {
    if (hasExact(start, end)) return;
    const protein = extractVariantHints(context(start,end).join(" ")).protein;
    clarify(start, end, idsFor(item => /seekh/i.test(item.name) && (!protein || item.name.toLowerCase().startsWith(protein.toLowerCase()))), "Which seekh kabab: chicken, lamb, or beef?");
  });
  find(/\b(?:tikka|tika|teeka)(?:\s+masalas?)?\b/g, (start, end) => {
    if (hasExact(start, end)) return;
    const protein = extractVariantHints(context(start,end).join(" ")).protein;
    clarify(start, end, idsFor(item => /tikka/i.test(item.name) && (!protein || item.protein === protein || item.name.toLowerCase().startsWith(protein.toLowerCase()))), "Which tikka masala would you like?");
  });
  find(/\b(?:biryani|biriyani|briyani)\b/g, (start, end) => {
    if (hasExact(start,end)) return;
    const nearby = context(start,end).join(" ");
    const protein = extractVariantHints(nearby).protein;
    clarify(start,end,idsFor(item => /biryani/i.test(item.name) && (!protein || item.name.toLowerCase().startsWith(protein.toLowerCase())) &&
      (!/\bmutton\b/.test(nearby) || /^(?:goat|lamb)\b/i.test(item.name))), /\bmutton\b/.test(nearby) ? "By mutton, do you mean goat or lamb biryani?" : "Which biryani: chicken, lamb, goat, or vegetable?");
  });
  find(/\b(?:korma|qorma|kurma)\b/g,(start,end)=>{
    if(hasExact(start,end))return;
    const protein=extractVariantHints(context(start,end).join(" ")).protein;
    clarify(start,end,idsFor(item=>item.family==="Korma"&&(!protein||item.protein===protein)),"Which korma: Chicken, Goat or Lamb?");
  });
  find(/\bpak(?:ora|oda)s?\b/g, (start,end) => {
    if (hasExact(start,end)) return;
    clarify(start,end,idsFor(item => /pakora/i.test(item.name)), "Did you mean Fish Pakora?");
  });
  find(/\b(?:chicken|chikan|chiken)\s+curry\b/g,(start,end) =>
    clarify(start,end,idsFor(item => item.protein === "Chicken" && (/Karahi|Korma|Tikka Masala/i.test(item.family ?? ""))), "Which chicken dish: karahi, tikka masala or korma?"));

  // An unavailable request cannot become a partial-name addition. Suggestions
  // are retrieval only and always refer to live items; consent is required.
  for (const rule of POLICY.nearMisses) for (const phrase of rule.phrases) {
    find(new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "g"), (start,end) => {
      for(let i=issues.length-1;i>=0;i--)if(overlaps(issues[i],{start,end}))issues.splice(i,1);
      const names=rule.candidates.map(id => MENU_BY_ID.get(id)!.name);
      add("unavailable","not_on_menu",start,end,rule.candidates,
        `${rule.displayName} isn't on this menu. Did you mean ${names.join(" or ")}? ${"note" in rule ? rule.note : ""}`.trim());
      // A proposed replacement has only the source item's protein metadata;
      // the rejected name cannot invent a protein field on Saag Paneer.
      for(const candidate of issues.find(issue=>issue.start === start && issue.kind === "unavailable")?.candidates ?? [])
        candidate.protein=MENU_BY_ID.get(candidate.itemId)!.protein;
    });
  }
  find(/\b(?:(?:peshawari\s+)?chapli\s+(?:kabab|kebab|kabob)|(?:vegetable|veggie|veg|paneer|chicken)\s+pak(?:ora|oda)|(?:pepperoni\s+)?pizza|okra(?:\s+masala)?|bhindi|(?:whole|boneless)\s+chicken\s+karahi|chicken\s+karahi\s+for\s+(?:two|2))\b/g, (start,end) => {
    if (hasExact(start,end)) return;
    const phrase = tokens.slice(start,end).join(" ");
    const vegetarian = /^(?:vegetable|veggie|veg|paneer)\s+pak/.test(phrase);
    const suggestions = closestMenuItems(phrase,3,vegetarian ? MENU.filter(item=>["Veggie Dishes","Sides"].includes(item.category)) : MENU);
    // Replace a generic issue contained in this explicit unavailable request.
    for (let i=issues.length-1;i>=0;i--) if(overlaps(issues[i],{start,end})) issues.splice(i,1);
    add("unavailable","not_on_menu",start,end,suggestions.map(item=>item.id),
      "That dish isn't on this menu. Would you like " + suggestions.map(item=>item.name).join(" or ") + " instead?");
  });
  const foodWords = tokens.filter(token => !STOPWORDS.has(token) && !(token in NUM_WORDS) &&
    !["medium","spice","spicy","extra","mild","hot","no","order","whole","make","change","set"].includes(token));
  const onlyProtein = foodWords.length === 1 && Boolean(PROTEIN_WORDS[foodWords[0]] || ["fish","shrimp","mutton"].includes(foodWords[0]));
  if (foodWords.length && !onlyProtein && !matches.length && !issues.length &&
      !/^(?:hello|hi|hey|thank|my name|my callback|where|when|what time|is pickup|that will|i have .*allerg|i need to speak)/i.test(joined) &&
      /\b(?:order|want|give me|like|chahiye|karahi|tikka|kebab|kabab|pakora|haleem|dosa|curry|biryani|chai|tea|chicken|goat|lamb|beef|fish|shrimp|mutton|rogan|josh|do you have)\b/i.test(joined) &&
      !/\b(?:recommend|menu|options|pickup|catering|hours|allergy|staff|call|name)\b/.test(joined)) {
    const protein=extractVariantHints(joined).protein;
    const suggestions = closestMenuItems(joined,3);
    const near=suggestions.filter(item=>{
      const words=MENU_TOKENS.get(item.id)!,query=foodWords.filter(word=>!PROTEIN_WORDS[word]&&!PORTION_WORDS[word]);
      return query.some(word=>word.length>=4&&words.some(other=>other.length>=4&&similarity(word,other)>=0.72))&&
        (extractVariantHints(joined).protein===undefined||item.name.toLowerCase().includes(extractVariantHints(joined).protein!.toLowerCase()));
    });
    const plausible=near.length>0;
    add(plausible?"clarify":"unavailable",plausible?"low_confidence":"not_on_menu",0,tokens.length,(plausible?near:suggestions).map(item=>item.id),
      plausible?"Did you mean "+near.map(item=>item.name).join(" or ")+"?":"I don't have that dish on this menu. Would you like " + suggestions.map(item=>item.name).join(" or ") + "?");
  }

  for (const match of matches) {
    if (match.quantityUncertain && !issues.some(issue => overlaps(issue, match))) {
      issues.push({ kind: "clarify", reason: "quantity", heard: match.heard, start: match.start, end: match.end,
        candidates: [match], question: `Please repeat the quantity for ${match.name}; I heard conflicting numbers.` });
    }
    if (match.requiresConfirmation && !issues.some((issue) => overlaps(issue, match))) {
      const choices = match.alternatives?.map((candidate) => ({ ...match, ...candidate,
        name: MENU_BY_ID.get(candidate.itemId)!.name, alternatives: undefined })) ?? [match];
      const repair = /\bkirby\b/i.test(match.heard);
      const question = repair ? "Did you mean chicken Karahi?" : `Did you mean ${choices.map((choice) => choice.name).join(" or ")}?`;
      issues.push({ kind: "clarify", reason: match.distinctiveToken ? "distinctive_token" : match.alternatives ? "low_margin" : repair ? "stt_repair" : "low_confidence",
        heard: match.heard, start: match.start, end: match.end, candidates: choices, question });
    }
    if ((!Number.isSafeInteger(match.qty) || match.qty < 1 || match.qty > 50) && !issues.some((issue) => overlaps(issue, match))) {
      issues.push({ kind: "clarify", reason: "quantity", heard: match.heard, start: match.start, end: match.end,
        candidates: [match], question: "Please say the item again with a quantity from one to fifty." });
    }
  }
  // Examine each otherwise-uncovered clause, even after another dish resolved.
  // Do not split a conjunction that is inside an already recognized full name.
  const cuts=[-1,...tokens.flatMap((token,index)=>["and","aur","plus","also","then"].includes(token)&&!matches.some(match=>match.start<=index&&match.end>index)?[index]:[]),tokens.length];
  if(cuts.length>2)for(let index=0;index<cuts.length-1;index++){
    const start=cuts[index]+1,end=cuts[index+1];
    if(start>=end||[...matches,...issues].some(entry=>overlaps(entry,{start,end})))continue;
    const sub=analyzeUtterance(tokens.slice(start,end).join(" "));
    issues.push(...sub.issues.map(issue=>({...issue,start:issue.start+start,end:issue.end+start,candidates:issue.candidates.map(candidate=>({...candidate,start:candidate.start+start,end:candidate.end+start}))})));
  }
  issues.sort((a, b) => a.start - b.start);
  // A clause is the safety boundary. A short exact side cannot escape an
  // unresolved compound food phrase; separate comma/conjunction clauses can.
  const commaCuts=[...text.matchAll(/,/g)].map(found=>tokenize(text.slice(0,found.index)).length);
  const clauseStarts=[0,...tokens.flatMap((token,index)=>["and","aur","plus","also","then"].includes(token)&&!matches.some(match=>match.start<=index&&match.end>index)?[index+1]:[]),...commaCuts];
  const boundaries=[...new Set([...clauseStarts,tokens.length])].sort((a,b)=>a-b);
  const nonFood=new Set(["half","full","large","small","regular","medium","spice","spicy","extra","mild","hot","no","not","make","change","set","now","quick","fast","hurry","jaldi","as","soon","possible","takeaway","price","prices","cost","how","much","what","whats","total","subtotal","bill","does","tell","friend","friends","family","myself","today","tonight","tomorrow"]);
  for(let index=0;index<boundaries.length-1;index++){
    const start=boundaries[index],end=boundaries[index+1];
    const covered=matches.filter(match=>overlaps(match,{start,end}));
    const local=tokens.slice(start,end);
    const noteAt=local.findIndex((word,i)=>["note","notes","without"].includes(word)||word==="on"&&local[i+1]==="the"&&local[i+2]==="side"||word==="no"&&!["spice","mirchi"].includes(local[i+1]));
    const unresolved=local.filter((word,offset)=>(noteAt<0||offset<noteAt)&&!covered.some(match=>start+offset>=match.start&&start+offset<match.end||match.quantityHeard===word&&start+offset===match.start-1)&&!STOPWORDS.has(word)&&!BOUNDARY.has(word)&&!nonFood.has(word)&&!(word in NUM_WORDS)&&!/^\d+$/.test(word));
    const short=covered.filter(match=>MENU_TOKENS.get(match.itemId)!.length===1);
    if(short.length&&unresolved.length&&!issues.some(issue=>overlaps(issue,{start,end}))){
      const heard=tokens.slice(start,end).join(" ");
      const choices=[...new Set([...closestMenuItems(heard,3).map(item=>item.id),...short.map(match=>match.itemId)])].slice(0,4);
      add("clarify","ambiguous",start,end,choices,`That phrase is ambiguous. Did you mean ${choices.map(id=>MENU_BY_ID.get(id)!.name).join(" or ")}, or separate items?`);
    }
    // Rejecting or questioning a clause cannot simultaneously add part of it.
    for(const issue of issues)if(overlaps(issue,{start,end})){issue.start=Math.min(issue.start,start);issue.end=Math.max(issue.end,end);}
  }
  return { matches: matches.filter((match) => !issues.some((issue) => overlaps(issue, match))), issues };
}

// The words of an utterance NOT consumed by any match, used so that variant
// hints ("goat", "half") are only read from words that belong to the pending
// item, not to other items mentioned in the same breath.
export function leftoverText(text: string, matches: Match[]): string {
  const tokens = tokenize(text);
  return tokens.filter((_, i) => !matches.some((m) => i >= m.start && i < m.end)).join(" ");
}

// Scan a short reply like "half goat please" for variant info alone.
export function extractVariantHints(text: string): { portion?: "half" | "full"; protein?: string } {
  const tokens = tokenize(text);
  const out: { portion?: "half" | "full"; protein?: string } = {};
  for (const t of tokens) {
    const portion = fuzzyKey(t, PORTION_WORDS);
    if (portion) out.portion = portion;
    const protein = fuzzyKey(t, PROTEIN_WORDS);
    if (protein) out.protein = protein;
  }
  return out;
}

// Retrieval never grants permission to add an item.
const RANK_LABELS=new Map(MENU.map(item=>[item,[item.name,...item.aliases].map(label=>{
  const words=tokenize(label).filter(word=>!PROTEIN_WORDS[word]&&!["fish","shrimp","mutton"].includes(word));
  return {joined:preparePhonetic(words.join("")),words:words.map(preparePhonetic)};
})]));
export function closestMenuItems(text: string, count = 3, pool: MenuItem[] = MENU): MenuItem[] {
  // Category evidence precedes phonetic retrieval. Never offer a bread as a
  // dessert or a drink as a curry just because its syllables happen to fit.
  if(pool===MENU){
    const category=/\b(?:sweet|dessert|mithai|ice cream)\b/i.test(text)?["Desserts"]:
      /\b(?:drink|beverage|juice|lassi)\b/i.test(text)?["Beverages"]:
      /\b(?:naan|bread|roti)\b/i.test(text)?["Naan"]:
      /\b(?:vindaloo|rogan josh|jalfrezi|curry|korma)\b/i.test(text)?["Handi Curry","Tikka Masala"]:undefined;
    if(category)pool=MENU.filter(item=>category.includes(item.category));
  }
  const words=tokenize(text).filter(token=>!STOPWORDS.has(token)&&!(token in NUM_WORDS)&&!PORTION_WORDS[token]);
  const protein=extractVariantHints(text).protein;
  const distinctive=words.filter(word=>!PROTEIN_WORDS[word]&&!["fish","shrimp","mutton"].includes(word));
  const heard=distinctive.length?distinctive:words;
  const query=preparePhonetic(heard.join(""));
  const preparedWords=heard.map(preparePhonetic);
  return pool.map((item,index)=>{
    const labels=RANK_LABELS.get(item)!;
    const score=Math.max(...labels.map(label=>.55*preparedSimilarity(query,label.joined)+.45*(preparedWords.reduce((sum,word)=>sum+Math.max(0,...label.words.map(other=>preparedSimilarity(word,other))),0)/Math.max(1,heard.length))));
    return {item,index,score,protein:protein&&(item.protein===protein||item.name.toLowerCase().startsWith(protein.toLowerCase()))?1:0};
  }).sort((a,b)=>b.score-a.score||b.protein-a.protein||a.index-b.index).slice(0,count).map(row=>row.item);
}
