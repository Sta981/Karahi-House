import assert from "node:assert/strict";
import test from "node:test";
import { runTurn, newState } from "../lib/dialog";
import { speechText } from "../lib/speech";

test("Roman Urdu and Punjabi menu words normalize from the recognition lexicon", () => {
  const words = ["pach", "bakra", "bakray", "bakri", "murgh", "murghi", "machli", "jhinga", "chawal", "qourma", "qorma", "kurma"];
  assert.deepEqual(words.map(speechText), [
    "five", "goat", "goat", "goat", "chicken", "chicken", "fish", "shrimp", "rice", "korma", "korma", "korma",
  ]);
});

test("recognized South Asian plural forms preserve count and menu identity", () => {
  assert.equal(speechText("raitain rotiyan samosay"), "raita roti samosa");

  const raita = runTurn(newState(), "pach raitain");
  assert.equal(raita.state.cart.find((line) => line.itemId === "RAITA")?.qty, 5);

  const samosas = runTurn(newState(), "teen veg samosain");
  assert.equal(samosas.state.cart.find((line) => line.itemId === "VEG_SAMOSAS")?.qty, 3);
});

test("known protein narrows karahi clarification to styles, and bare korma asks protein", () => {
  const chickenKarahi = runTurn(newState(), "murghi karahi");
  assert.match(chickenKarahi.reply, /style/i);
  assert.doesNotMatch(chickenKarahi.reply, /protein/i);
  assert.match(chickenKarahi.reply, /white/i);

  const goatKarahi = runTurn(newState(), "bakri karahi");
  assert.match(goatKarahi.reply, /style/i);
  assert.doesNotMatch(goatKarahi.reply, /protein/i);

  const bareKorma = runTurn(newState(), "kurma");
  assert.match(bareKorma.reply, /chicken/i);
  assert.match(bareKorma.reply, /goat/i);
  assert.match(bareKorma.reply, /lamb/i);
});

test("pending choice questions list only valid options and do not mark staff review", () => {
  let state = runTurn(newState(), "goat karahi").state;
  const styles = runTurn(state, "what styles can I choose");
  state = styles.state;
  assert.match(styles.reply, /Lahori/i);
  assert.match(styles.reply, /White/i);
  assert.doesNotMatch(styles.reply, /Staff review/i);

  const proteins = runTurn(state, "what proteins are available");
  assert.match(proteins.reply, /Goat/i);
  assert.match(proteins.reply, /Lamb/i);
  assert.match(proteins.reply, /Chicken/i);
  assert.notEqual(proteins.reply, styles.reply);
  assert.ok(proteins.reply.length < 150);
  assert.equal(proteins.state.needsReview, undefined);
  assert.equal(proteins.state.recognition?.issues.length, 1);

  const korma = runTurn(runTurn(newState(), "korma").state, "kya kya hai");
  assert.match(korma.reply, /Chicken/i);
  assert.match(korma.reply, /Goat/i);
  assert.match(korma.reply, /Lamb/i);
  assert.equal(korma.state.needsReview, undefined);

  const sizeState = runTurn(newState(), "one chicken lahori karahi").state;
  const sizes = runTurn(sizeState, "what sizes can I order");
  assert.match(sizes.reply, /Half/i);
  assert.match(sizes.reply, /Full/i);
  assert.equal(sizes.state.needsReview, undefined);
});

test("unresolved food clauses keep their quantity and their own notes until resolved", () => {
  let state = runTurn(newState(), "one chicken karahi, four mint raita, three garlic naan").state;
  assert.equal(state.cart.find((line) => line.itemId === "GARLIC_NAAN_BREAD")?.qty, 3);

  state = runTurn(state, "white chicken karahi").state;
  assert.match(state.recognition?.issues[0]?.question ?? "", /Raita/i);
  state = runTurn(state, "raita").state;
  assert.equal(state.cart.find((line) => line.itemId === "RAITA")?.qty, 4);
  state = runTurn(state, "half").state;
  assert.equal(state.cart.find((line) => line.itemId === "CHICKEN_WHITE_KARAHI")?.size, "Half");

  state = runTurn(newState(), "one chicken white karahi half").state;
  state = runTurn(state, "qorma no ginger").state;
  state = runTurn(state, "korma lamb").state;
  assert.ok(state.cart.find((line) => line.itemId === "KORMA_LAMB")?.notes.some((note) => /ginger/i.test(note)));
  assert.equal(state.cart.find((line) => line.itemId === "CHICKEN_WHITE_KARAHI")?.notes.some((note) => /ginger/i.test(note)), false);
});

test("whole-order spice is disclosed once and category browsing pages five at a time", () => {
  let state = newState();
  for (const text of ["three garlic naan", "one lamb biryani", "one korma lamb", "that's all"]) {
    state = runTurn(state, text).state;
  }
  const spice = runTurn(state, "make everything no spice");
  assert.ok(spice.reply.length < 120);
  assert.match(spice.reply, /No Spice for everything/i);
  assert.equal(spice.disclosure?.length, 1);
  assert.ok(spice.state.cart.every((line) => line.spiceLevel === "No Spice"));

  const first = runTurn(newState(), "show me the full menu");
  assert.ok((first.reply.match(/,/g) ?? []).length < 5);
  assert.match(first.reply, /Want more\?/i);
  const next = runTurn(first.state, "more");
  assert.notEqual(next.reply, first.reply);
  assert.ok((next.reply.match(/,/g) ?? []).length < 5);
});
