// DesiPhone: a phonetic encoder tuned for South Asian food vocabulary as it
// comes out of speech-to-text engines and non-native spellings.
//
// Standard algorithms (Soundex, Metaphone) are built around English phonology
// and miss the specific confusions that matter here:
//
//   - Retroflex flap ɽ heard as "r" OR "d":  karahi / kadai / kadhai
//   - Aspiration dropped or added freely:    kh/k, gh/g, bh/b, dh/d, th/t, ph/f
//   - q and k merge:                         qeema / keema, qorma / korma
//   - w and v merge:                         shinwari / shinvari
//   - z and j swap in some accents:          zeera / jeera
//   - Long/short vowels are unreliable:      seekh / sikh / seek, boti / booti
//   - Trailing schwa appears/disappears:     samosa / samose / samosay
//
// The encoder normalizes both the menu vocabulary and the incoming transcript
// into a space where these variations collapse to the same code.

export function desiPhone(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";

  // --- Digraph and cluster normalization (aspiration, common clusters) ---
  s = s
    .replace(/ck/g, "k")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/dh/g, "d")
    .replace(/th/g, "t")
    .replace(/zh/g, "j")
    .replace(/chh/g, "c")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/aa/g, "a");

  // --- Single-consonant merges ---
  s = s
    .replace(/q/g, "k")
    .replace(/c(?=[^h]|$)/g, "k") // remaining hard c
    .replace(/z/g, "j")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/y/g, "i");

  // --- Retroflex flap: intervocalic d sounds like r (kadai -> karai, pakoda -> pakora) ---
  s = s.replace(/(?<=[aeiou])d(?=[aeiou])/g, "r");

  // --- h is silent unless word-initial ---
  s = s[0] + s.slice(1).replace(/h/g, "");

  // --- Vowel skeleton: keep a word-initial vowel, drop the rest ---
  const head = s[0];
  let tail = s.slice(1).replace(/[aeiou]/g, "");
  s = (("aeiou".includes(head) ? "a" : head) + tail);

  // --- Collapse doubled letters ---
  s = s.replace(/(.)\1+/g, "$1");

  return s;
}

// Damerau-Levenshtein distance (with transpositions), used on phonetic codes.
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // The same optimal-string-alignment recurrence needs only the last two
  // rows, including transpositions. Avoid allocating an entire matrix per pair.
  let previousPrevious = new Uint32Array(n + 1);
  let previous = new Uint32Array(n + 1);
  let current = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) previous[j] = j;
  for (let i = 1; i <= m; i++) {
    current[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], previousPrevious[j - 2] + 1);
      }
    }
    const retired = previousPrevious;
    previousPrevious = previous; previous = current; current = retired;
  }
  return previous[n];
}

export interface PreparedPhonetic { normalized: string; code: string }
export function preparePhonetic(raw: string): PreparedPhonetic {
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  return { normalized, code: desiPhone(normalized) };
}
// Distance cannot be smaller than the operands' length difference. This is
// an upper bound on the original score, not a replacement score or threshold.
export function similarityUpperBound(left: PreparedPhonetic, right: PreparedPhonetic): number {
  const a = left.normalized, b = right.normalized, pa = left.code, pb = right.code;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const phon = pa && pb ? 1 - Math.abs(pa.length - pb.length) / Math.max(pa.length, pb.length) : 0;
  const raw = 1 - Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  return 0.72 * phon + 0.28 * raw;
}
// Immutable menu/alias operands are prepared once; request operands remain
// request-local. Scores are identical to similarity, including empty strings.
export function preparedSimilarity(left: PreparedPhonetic, right: PreparedPhonetic): number {
  const a = left.normalized, b = right.normalized;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pa = left.code, pb = right.code;
  const phonSim = pa && pb ? 1 - editDistance(pa, pb) / Math.max(pa.length, pb.length) : 0;
  const rawSim = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return 0.72 * phonSim + 0.28 * rawSim;
}

// Similarity in [0,1] combining phonetic-code distance and raw-string distance.
export function similarity(rawA: string, rawB: string): number {
  return preparedSimilarity(preparePhonetic(rawA), preparePhonetic(rawB));
}
