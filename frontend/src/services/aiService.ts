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

export type AiInterpretResult =
  | { type: "proposal"; message: string; proposal: AiProposal }
  | { type: "clarification"; message: string };

/** The model only proposes. Nothing is saved until confirm() is called after the user agrees. */
export const aiService = {
  interpret: (text: string) =>
    api.request<AiInterpretResult>("/api/ai/interpret", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  confirm: (proposal: AiProposal) =>
    api.request<unknown>("/api/ai/proposals/confirm", {
      method: "POST",
      body: JSON.stringify(proposal),
    }),
};
