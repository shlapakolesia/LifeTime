import { api } from "./apiClient";

export type AiProposal =
  | {
      kind: "event";
      data: {
        title: string;
        description: string;
        startsAt: string;
        endsAt: string;
        timezone: string;
        category: string;
        location: string;
        privacy: string;
        participantIds: string[];
        recheckAvailability: boolean;
      };
    }
  | {
      kind: "task";
      data: {
        title: string;
        description: string;
        deadline?: string | null;
        priority: string;
        completed: boolean;
        estimatedMinutes?: number | null;
      };
    };

export interface AiHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export type AiInterpretResult =
  | { type: "proposal"; message: string; proposal: AiProposal }
  | { type: "clarification"; message: string };

/** The model only proposes. Nothing is saved until confirm() is called after the user agrees. */
export const aiService = {
  /** `history` is the earlier chat, so a short answer like "10:00" is understood in context. */
  interpret: (text: string, history: AiHistoryTurn[] = []) =>
    api.request<AiInterpretResult>("/api/ai/interpret", {
      method: "POST",
      body: JSON.stringify({ text, history }),
    }),
  confirm: (proposal: AiProposal) =>
    api.request<unknown>("/api/ai/proposals/confirm", {
      method: "POST",
      body: JSON.stringify(proposal),
    }),
};
