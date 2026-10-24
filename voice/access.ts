// Local mic testing never needs the password used by a public-bound demo.
export function demoAccessCode(host: string, configured = ""): string {
  if (["127.0.0.1", "localhost", "::1"].includes(host)) return "";
  const code = configured.trim();
  if (code.length < 24) throw Error("Public demo requires a private access code of at least twenty-four characters");
  return code;
}
