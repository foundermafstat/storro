import { describe, expect, it } from "vitest";
import { builtInTemplates } from "@/services/template-service";

describe("template registry", () => {
  it("defines required fields for every built-in commercial template", () => {
    const expectedIds = [
      "long-article",
      "dorahacks-progress",
      "github-release-notes",
      "linkedin-post",
      "x-thread",
      "daily-build-journal",
      "investor-update",
      "internal-changelog",
    ];

    expect(builtInTemplates.map((template) => template.id)).toEqual(expectedIds);

    for (const template of builtInTemplates) {
      expect(template.name).toBeTruthy();
      expect(template.format).toBeTruthy();
      expect(template.audience).toBeTruthy();
      expect(template.tone).toBeTruthy();
      expect(template.requiredSections.length).toBeGreaterThan(0);
      expect(template.lengthLimits).not.toEqual({});
      expect(template.privateFactPolicy).toBeTruthy();
      expect(template.groundingRules).toEqual({
        requireApprovedFacts: true,
        requireFactIds: true,
        requireClaimsToAvoid: true,
        allowUngroundedClaims: false,
      });
      expect(template.minimumPlan).toBeTruthy();
    }
  });
});
