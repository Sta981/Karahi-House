import type { SttModel } from "./contracts";
export type EndpointSettings = { id: string; fluxThreshold: number; fluxTimeoutMs: number; novaEndpointMs: number; novaUtteranceEndMs: number };
export const ENDPOINT_PROFILES: EndpointSettings[] = [
  { id: "baseline", fluxThreshold: .7, fluxTimeoutMs: 1500, novaEndpointMs: 300, novaUtteranceEndMs: 1000 },
  { id: "cautious", fluxThreshold: .85, fluxTimeoutMs: 2500, novaEndpointMs: 600, novaUtteranceEndMs: 1500 },
  { id: "patient", fluxThreshold: .95, fluxTimeoutMs: 3000, novaEndpointMs: 900, novaUtteranceEndMs: 1800 },
];
export function endpointSettings(model: SttModel, id = "baseline") {
  const setting = ENDPOINT_PROFILES.find(profile => profile.id === id);
  if (!setting) throw Error("Unknown endpoint profile");
  return setting;
}
