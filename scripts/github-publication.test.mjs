import test from "node:test";
import assert from "node:assert/strict";
import { publishable, assertNoSecrets } from "./lib/github-publication.mjs";

test("publication excludes hidden paths, private data and held-out material", () => {
  for (const file of [".env.local", ".env.example", ".gitignore", ".data/call.csv", ".git/config", "docs/.private/info.md", "eval/held-out/cases.json", "eval/results/voice-live.json", "eval/archive/old-menu/lib/menu.ts", "scripts/run-held-out.mjs", "scripts/lib/scoring.mjs", "docs/recording.wav", "docs/completed-results.csv", "docs/keys.pem", "scripts/../.env.local"]) assert.equal(publishable(file), false, file);
});
test("source, blank templates and synthetic audio remain publishable", () => {
  for (const file of ["app/page.tsx", "lib/menu-source.json", "voice/session.ts", "public/voice-audio/clip.pcm", "env.example", "package-lock.json", "scripts/live-call-patterns.test.ts", "eval/parser-dev-cases.mjs", "docs/real-mic-results-template.csv"]) assert.equal(publishable(file), true, file);
});
test("actual configured secrets and nonempty environment placeholders block publication without leaking values", () => {
  const secret = "a-test-credential-that-must-never-be-published";
  assert.throws(() => assertNoSecrets("app/page.tsx", Buffer.from(`value=${secret}`), [secret]), error => !error.message.includes(secret));
  assert.throws(() => assertNoSecrets("env.example", Buffer.from("DEEPGRAM_API_KEY=not-empty\n")));
  assert.doesNotThrow(() => assertNoSecrets("env.example", Buffer.from("# values belong in .env.local\nDEEPGRAM_API_KEY=\n")));
  assert.throws(() => assertNoSecrets("docs/key.txt", Buffer.from("-----BEGIN " + "PRIVATE KEY-----")));
});
