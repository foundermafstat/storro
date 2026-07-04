import { describe, expect, it } from "vitest";
import {
  defaultSourceParserRegistry,
  parseSourceDocumentContent,
  SourceParserRegistry,
} from "@/services/source-parser-service";

describe("source parser registry", () => {
  it("selects a parser by source type and file extension", async () => {
    const result = await parseSourceDocumentContent({
      sourceType: "FILE_UPLOAD",
      title: "release.md",
      rawObjectKey: "orgs/org/projects/project/sources/release.md",
      rawText: "# Release\nA complete source document for parser testing.",
    });

    expect(result.text).toContain("complete source document");
    expect(result.sections).toEqual([
      {
        title: "Release",
        startLine: 1,
        endLine: 2,
      },
    ]);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("returns a controlled error for unsupported file types", async () => {
    await expect(
      parseSourceDocumentContent({
        sourceType: "FILE_UPLOAD",
        title: "archive.zip",
        rawObjectKey: "orgs/org/projects/project/sources/archive.zip",
        rawText: "zip bytes are not parsed by the text parser",
      }),
    ).rejects.toThrow("Unsupported source parser.");
  });

  it("isolates parser failures behind service errors", async () => {
    const registry = new SourceParserRegistry().register({
      id: "failing-json",
      sourceTypes: ["CHATGPT_EXPORT"],
      parse() {
        JSON.parse("{broken");
        throw new Error("unreachable");
      },
    });

    await expect(
      parseSourceDocumentContent(
        {
          sourceType: "CHATGPT_EXPORT",
          title: "chatgpt.json",
          rawText: "{broken",
        },
        registry,
      ),
    ).rejects.toThrow("Source parser failed.");
  });

  it("extracts text from JSON exports", async () => {
    const result = await parseSourceDocumentContent(
      {
        sourceType: "CHATGPT_EXPORT",
        title: "chatgpt.json",
        rawText: JSON.stringify({ title: "Build log", messages: ["Created parser", "Added tests"] }),
      },
      defaultSourceParserRegistry,
    );

    expect(result.text).toContain("Created parser");
    expect(result.metadata).toMatchObject({
      rootType: "object",
    });
  });
});
