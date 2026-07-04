import { describe, expect, it } from "vitest";
import { calculateSourceExtractionPriority } from "@/services/source-service";

describe("manual note extraction ranking", () => {
  it("prioritizes manual notes above imported sources", () => {
    const manualPriority = calculateSourceExtractionPriority({
      sourceType: "MANUAL_NOTE",
      metadata: {
        manualNote: {
          rankingBoost: 50,
        },
      },
    });
    const chatGptPriority = calculateSourceExtractionPriority({
      sourceType: "CHATGPT_EXPORT",
      metadata: null,
    });

    expect(manualPriority).toBeGreaterThan(chatGptPriority);
  });
});
