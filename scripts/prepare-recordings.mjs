import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RECORDING_PLAN, RECORDING_PROMPTS } from "../eval/recording-plan.mjs";
import { sha256 } from "./lib/load-matcher.mjs";

const directory = path.resolve(".data/evaluation");
mkdirSync(directory, { recursive: true });
const fingerprint = sha256(JSON.stringify({ plan: RECORDING_PLAN, prompts: RECORDING_PROMPTS }));
const lockFile = path.join(directory, "split-lock.json");
if (existsSync(lockFile)) {
  assert.equal(JSON.parse(readFileSync(lockFile, "utf8")).fingerprint, fingerprint,
    "Recording plan changed after freeze. Keep existing speaker assignments and review before changing the split.");
} else {
  writeFileSync(lockFile, `${JSON.stringify({ fingerprint, plan: RECORDING_PLAN, prompts: RECORDING_PROMPTS }, null, 2)}\n`, { flag: "wx" });
}

const headers = ["clip_id", "speaker_id", "split", "prompt_id", "prompt_text", "planned_expected_json", "audio_path", "consent_given", "consent_date", "recorded_at", "reference_transcript", "ground_truth_verified", "delete_by", "notes"];
const rows = [];
for (const speaker of RECORDING_PLAN.speakers) {
  mkdirSync(path.resolve(".data/audio", speaker.id), { recursive: true });
  for (const prompt of RECORDING_PROMPTS) {
    rows.push([`${speaker.id}-${prompt.id}`, speaker.id, speaker.split, prompt.id, prompt.text,
      JSON.stringify(prompt.expected), `.data/audio/${speaker.id}/${prompt.id}.wav`, "false", "", "", "", "false", "", ""]);
  }
}
assert.equal(rows.length, RECORDING_PLAN.targetUtterances);
const csv = (value) => `"${String(value).replaceAll('"', '""')}"`;
const manifest = path.join(directory, "recordings.csv");
if (!existsSync(manifest)) {
  writeFileSync(manifest, `${[headers, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`, { flag: "wx" });
  console.log("Created .data/evaluation/recordings.csv with 100 PLANNED slots; no recordings collected by this command.");
} else {
  console.log("Existing private manifest preserved, including consent and transcript edits.");
}
const present = rows.filter((row) => existsSync(path.resolve(row[6]))).length;
console.log(`Fixed split: 3 development speakers / 60 slots; 2 held-out speakers / 40 slots.`);
console.log(`Audio files currently present: ${present}/100. Presence does not establish consent, validity, or verified ground truth.`);
console.log("No audio decoded, transcribed, or uploaded. Only consented, verified recordings may enter a future audio evaluation.");
