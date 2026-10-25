import {execFileSync} from "node:child_process";
// Deliberately publish a source snapshot, never the development Git history.
const roots = ["app/", "components/", "lib/", "voice/", "public/", "docs/", "scripts/"];
const files = new Set(["README.md", "env.example", "package.json", "package-lock.json", "next.config.mjs", "next-env.d.ts", "tsconfig.json", "render.yaml"]);

export function publishable(file) {
  if (file.includes("\\") || file.split("/").some(part => !part || part.startsWith("."))) return false;
  if (/(^|\/)(?:node_modules|recordings|transcripts|logs)(?:\/|$)/i.test(file)) return false;
  if (/held[-_]?out|burned|(^|\/)(?:conversation-eval|scoring|separate-metrics)\./i.test(file)) return false;
  if (/\.(?:pem|key|p12|pfx|wav|mp3|ogg|webm|m4a|log)$/i.test(file)) return false;
  if (/\.csv$/i.test(file) && file !== "docs/real-mic-results-template.csv") return false;
  return files.has(file) || roots.some(root => file.startsWith(root)) || /^eval\/[^/]+\.mjs$/.test(file);
}

export function assertNoSecrets(file, bytes, privateValues = []) {
  for (const value of privateValues) {
    if (bytes.includes(Buffer.from(value))) throw Error(`Private credential detected in ${file}; publication stopped`);
  }
  if (file.endsWith(".pcm")) return;
  const text = bytes.toString("utf8");
  const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{30,}|gsk_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/];
  if (patterns.some(pattern => pattern.test(text))) throw Error(`Possible credential detected in ${file}; publication stopped`);
  if (file === "env.example" && text.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith("#") && !/^[A-Z][A-Z0-9_]*=$/.test(line))) {
    throw Error("env.example must contain empty placeholders only");
  }
}

export function readStagedBlob(directory,file,expectedBytes){
  try{return execFileSync("git",["-C",directory,"show",`:${file}`],{maxBuffer:Math.max(1024*1024,expectedBytes+65536),stdio:["ignore","pipe","pipe"]});}
  catch{throw Error("Staged blob verification failed; publication stopped without exposing its contents");}
}
