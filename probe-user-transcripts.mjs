// Acceptance probe: replays real demo transcripts against the order engine.
// Run from the project root:   node probe-user-transcripts.mjs
// Offline (no API calls). Exit code 1 if any check fails.
import { loadVersion } from "./scripts/lib/load-version.mjs";

globalThis.fetch = async () => { throw new Error("offline"); };
const api = loadVersion();

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = "") {
  (ok ? pass++ : fail++);
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        -> ${detail}`}`);
}
const line = (st, id) => st.cart.find((l) => l.itemId === id);
const qty = (st, id) => st.cart.filter((l) => l.itemId === id).reduce((n, l) => n + l.qty, 0);
const cartStr = (st) =>
  st.cart.map((l) => `${l.qty}x ${l.itemId}${l.size ? `[${l.size}]` : ""}${l.spiceLevel ? `(${l.spiceLevel})` : ""}${l.notes?.length ? ` notes:${l.notes.join("/")}` : ""}`).join(" ; ") || "(empty)";

function run(turns) {
  let st = api.newState();
  const log = [];
  for (const text of turns) {
    const r = api.runTurn(st, text);
    st = r.state;
    log.push({ text, reply: r.reply, cart: cartStr(st), st });
  }
  return log;
}

// ---- Session 1: Urdu/Punjabi words and pending-question questions
{
  const s = run(["chaar naan", "panj raitay"]);
  check("S1  'chaar naan' -> 4 Plain Naan", qty(s[0].st, "PLAIN_NAAN_BREAD") === 4, s[0].cart);
  check("S1  'panj raitay' -> 5 Raita (Punjabi 5 + plural -ay)", qty(s[1].st, "RAITA") === 5, `${s[1].reply} | ${s[1].cart}`);

  const k = run(["bakra karahi"]);
  check("S1  'bakra karahi' (goat) asks ONLY the style, not the protein", !/protein/i.test(k[0].reply), k[0].reply);

  const q = run(["bakra karahi", "which styles you have?", "which protein you have?"]);
  check("S1  'which styles you have?' lists styles (Lahori, White...)", /lahori/i.test(q[1].reply) && /white/i.test(q[1].reply), q[1].reply);
  check("S1  'which protein you have?' lists proteins (Goat, Lamb, Chicken)", /goat/i.test(q[2].reply) && /chicken/i.test(q[2].reply), q[2].reply);
  check("S1  menu question never goes to staff review", !/staff review/i.test(q[2].reply), q[2].reply);
  check("S1  the same prompt is never repeated twice in a row", q[1].reply !== q[0].reply, q[1].reply);
  check("S1  replies stay short (under 220 characters)", q.every((x) => x.reply.length < 220), q.map((x) => x.reply.length).join(","));
}

// ---- Session 2: several clauses in one sentence, modifiers, bulk spice
{
  const s = run([
    "yes one chicken karahi ,four mint raita , three garlic naan",
    "white chicken karahi",
    "raita",
    "half",
  ]);
  check("S2  'chicken karahi' asks only the STYLE (chicken already said)", !/protein/i.test(s[0].reply), s[0].reply);
  check("S2  3 Garlic Naan added", qty(s[0].st, "GARLIC_NAAN_BREAD") === 3, s[0].cart);
  const end = s[3].st;
  check("S2  'four mint raita' keeps quantity 4 (never becomes 1)", qty(end, "RAITA") === 4, cartStr(end));
  check("S2  Chicken White Karahi Half x1 in cart", !!line(end, "CHICKEN_WHITE_KARAHI") && line(end, "CHICKEN_WHITE_KARAHI").size === "Half", cartStr(end));
  check("S2  all three clauses accounted for", qty(end, "GARLIC_NAAN_BREAD") === 3 && qty(end, "RAITA") === 4 && qty(end, "CHICKEN_WHITE_KARAHI") === 1, cartStr(end));

  const m = run(["one chicken white karahi half", "qourma without ginger"]);
  const karahi = line(m[1].st, "CHICKEN_WHITE_KARAHI");
  check("S2  'qourma without ginger' must NOT put the note on the karahi", !(karahi?.notes ?? []).some((n) => /ginger/i.test(n)), cartStr(m[1].st));
  check("S2  'qourma' asks Chicken, Goat or Lamb", /goat/i.test(m[1].reply) && /lamb/i.test(m[1].reply), m[1].reply);

  const m2 = run(["one chicken white karahi half", "qourma without ginger", "korma lamb"]);
  const korma = line(m2[2].st, "KORMA_LAMB");
  check("S2  note 'without ginger' lands on the Korma Lamb it belonged to", (korma?.notes ?? []).some((n) => /ginger/i.test(n)), cartStr(m2[2].st));

  const b = run(["three garlic naan", "one lamb biryani", "one korma lamb", "its over", "no spice"]);
  const last = b[b.length - 1];
  check("S2  bulk spice reply is ONE short sentence (under 120 chars)", last.reply.length < 120, `${last.reply.length} chars: ${last.reply}`);
  check("S2  bulk spice still applied to every spice dish", b[4].st.cart.filter((l) => l.itemId !== "RAITA").every((l) => l.spiceLevel === "No Spice"), cartStr(last.st));
}

// ---- Regression checks that already pass (must keep passing)
{
  const r = run(["two beef seekh kebab", "actually remove the beef seekh kebab"]);
  check("REG remove with qty > 1 asks 'one or both'", /one or both|1 or 2|both/i.test(r[1].reply) && qty(r[1].st, "BEEF_SEEKH_KABAB") === 2, `${r[1].reply} | ${r[1].cart}`);
  const f = run(["fish pakora one fish pakora", "only one"]);
  check("REG repeated dish asks one or two, 'only one' sets 1", qty(f[1].st, "FISH_PAKORA") === 1, f[1].cart);
  const c = run(["one fish pakora", "why did you add four fish pakora"]);
  check("REG complaint never changes the cart", qty(c[1].st, "FISH_PAKORA") === 1, c[1].cart);
}

console.log(results.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
