import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not inherit a tracing root from unrelated parent-directory lockfiles.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};

// A build clears its output directory. Never share that directory with a live
// dev server or the browser fixtures: its already-served HTML would refer to
// deleted CSS/JavaScript chunks. Each entrypoint has one stable cache folder.
export function developmentConfig(kind = "web") {
  if (!["web", "voice", "browser"].includes(kind)) throw Error("Invalid development server kind");
  return { ...nextConfig, distDir: `.next-dev-${kind}` };
}

export function useDevelopmentCache(kind) {
  developmentConfig(kind);
  // Next 15's custom-server prepare() reloads next.config itself and does not
  // forward options.conf. A process-local selector reaches that same config.
  // This is set by the entrypoint, not a credential or a required .env setting.
  process.env.KARAHI_NEXT_DEV_INSTANCE = kind;
}

export default function config(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  return developmentConfig(process.env.KARAHI_NEXT_DEV_INSTANCE || "web");
}
