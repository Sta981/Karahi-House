// The deterministic dialog owns recognition, clarification and every order change.
// Only unresolved informational turns reach the single, provider-neutral LLM path.
import { Match, analyzeUtterance } from "./matcher";
import { CallSummary, DialogState, GREETING, newState, requiresStaffReview, runTurn } from "./dialog";
import { buildLlmRequest } from "./llm-context";
import { LanguageModel, getLanguageModel, parseLlmReply } from "./llm";
import { RoutingEvent, recordTurn } from "./turn-metrics";
import { MENU_SOURCE_SHA256 } from "./menu";

export interface SmartTurnResult {
  reply: string;
  state: DialogState;
  matches: Match[];
  summary?: CallSummary;
  endCall?: boolean;
  usedLLM: boolean;
  routing: RoutingEvent;
}

export interface SmartTurnOptions {
  // null explicitly disables network access, including when credentials exist.
  provider?: LanguageModel | null;
  onRouting?: (event: RoutingEvent) => void;
}

export async function runSmartTurn(
  prevState: DialogState | undefined,
  text: string,
  _history: { role: "user" | "assistant"; text: string }[],
  options: SmartTurnOptions = {},
): Promise<SmartTurnResult> {
  const state = prevState?.cart && prevState.menuHash === MENU_SOURCE_SHA256 ? prevState : newState();
  const record = options.onRouting ?? recordTurn;
  const finish = (result: Omit<SmartTurnResult, "routing">, routing: RoutingEvent): SmartTurnResult => {
    record(routing);
    return { ...result, routing };
  };
  const trimmed = text.trim();
  if (!trimmed) {
    return finish({ reply: GREETING, state: { ...state, turns: state.turns + 1 }, matches: [], usedLLM: false },
      { route: "local", outcome: "local", candidateCount: 0 });
  }

  const analysis = analyzeUtterance(trimmed);
  const local = runTurn(state, trimmed, analysis);
  // Pending confirmations, staff review and checkout remain local even if the
  // legacy dialog marks a failed clarification as needing conversational help.
  const guarded = state.phase !== "open" || state.recognition || state.pendingCorrection || state.needsReview ||
    local.state.needsReview || analysis.issues.length || requiresStaffReview(trimmed);
  if (!local.needsLLM || guarded) {
    return finish({ ...local, usedLLM: false }, { route: "local", outcome: "local", candidateCount: 0 });
  }

  const request = buildLlmRequest(trimmed, local.state, analysis.matches);
  const candidateCount = request.candidateCount;
  const provider = options.provider === undefined ? getLanguageModel() : options.provider;
  if (!provider) {
    return finish({ ...local, usedLLM: false }, { route: "llm_needed", outcome: "disabled", candidateCount });
  }
  try {
    const raw = await provider.completeJson(request);
    const reply = parseLlmReply(raw, request.allowedReplies);
    if (!reply) {
      return finish({ ...local, usedLLM: false }, { route: "llm_needed", outcome: "rejected_reply", candidateCount });
    }
    // No model actions, item IDs, prices or quantities can mutate the cart.
    return finish({ ...local, reply, usedLLM: true }, { route: "llm_needed", outcome: "ok", candidateCount });
  } catch {
    // Never log raw provider errors: they may contain request data or headers.
    return finish({ ...local, usedLLM: false }, { route: "llm_needed", outcome: "error", candidateCount });
  }
}
