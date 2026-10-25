import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Native dotenv loading only: never execute/interpolate values or call a provider.
if (existsSync(".env.local")) loadEnvFile(".env.local");

const credentials = [
  "DEEPGRAM_API_KEY",
  "GROQ_API_KEY",
  "VAPI_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPI_PUBLIC_KEY",
  "RENDER_API_KEY",
  "GITHUB_TOKEN",
  "VOICE_DEMO_ACCESS_TOKEN",
  "RESEND_API_KEY",
  "DEMO_NOTIFICATION_EMAIL",
];
console.log(`.env.local: ${existsSync(".env.local") ? "present" : "not present"}`);
for (const name of credentials) {
  console.log(`${name}: ${process.env[name]?.trim() ? "present" : "missing"}`);
}
console.log("Presence only; credentials were not authenticated. No API requests made.");
console.log("Offline text evaluation works without credentials.");
console.log("Streaming /voice needs DEEPGRAM_API_KEY only; local Kokoro needs no API key. Vapi/Twilio/Groq are not required.");
console.log(`VOICE_FAQ_ENABLED: ${process.env.VOICE_FAQ_ENABLED === "true" ? "enabled" : "off (default)"}`);
console.log(`DEMO_NOTIFICATIONS_ENABLED: ${process.env.DEMO_NOTIFICATIONS_ENABLED === "true" ? "enabled" : "off (default)"}`);
