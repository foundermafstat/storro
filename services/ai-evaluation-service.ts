import { redactText } from "@/services/redaction-service";

export type AiEvaluationIssueType =
  | "invented_claim"
  | "secret_leak"
  | "generic_phrasing"
  | "ungrounded_sentence";

export type AiEvaluationIssue = {
  type: AiEvaluationIssueType;
  severity: "warning" | "failure";
  message: string;
  excerpt: string;
};

export function evaluateAiArtifact(input: {
  contentMarkdown: string;
  approvedFacts: string[];
}) {
  const issues: AiEvaluationIssue[] = [
    ...detectSecretLeaks(input.contentMarkdown),
    ...detectGenericPhrasing(input.contentMarkdown),
    ...detectGroundingIssues(input.contentMarkdown, input.approvedFacts),
  ];

  return {
    passed: issues.every((issue) => issue.severity !== "failure"),
    issues,
  };
}

function detectSecretLeaks(markdown: string): AiEvaluationIssue[] {
  return redactText(markdown).findings.map((finding) => ({
    type: "secret_leak",
    severity: "failure",
    message: `${finding.label} appears in generated content.`,
    excerpt: markdown.slice(finding.start, finding.end),
  }));
}

function detectGenericPhrasing(markdown: string): AiEvaluationIssue[] {
  const genericPatterns = [
    /\bgame[- ]changer\b/i,
    /\bcutting[- ]edge\b/i,
    /\bseamless(?:ly)?\b/i,
    /\brevolutionary\b/i,
  ];

  return genericPatterns
    .flatMap((pattern) => markdown.match(pattern) ?? [])
    .map((match) => ({
      type: "generic_phrasing" as const,
      severity: "warning" as const,
      message: "Generated content uses generic marketing phrasing.",
      excerpt: match,
    }));
}

function detectGroundingIssues(markdown: string, approvedFacts: string[]): AiEvaluationIssue[] {
  const facts = approvedFacts.map(normalize);
  const factVocabulary = new Set(facts.flatMap((fact) => significantTerms(fact)));
  const issues: AiEvaluationIssue[] = [];

  for (const sentence of extractSentences(markdown)) {
    const normalizedSentence = normalize(sentence);
    const terms = significantTerms(normalizedSentence);
    const overlap = terms.filter((term) => factVocabulary.has(term));
    const grounded = facts.some((fact) => normalizedSentence.length > 0 && (fact.includes(normalizedSentence) || overlap.length >= 2));

    if (!grounded) {
      issues.push({
        type: containsHighRiskClaim(sentence) ? "invented_claim" : "ungrounded_sentence",
        severity: containsHighRiskClaim(sentence) ? "failure" : "warning",
        message: containsHighRiskClaim(sentence)
          ? "Generated content contains a high-risk claim not present in approved facts."
          : "Generated sentence is weakly grounded in approved facts.",
        excerpt: sentence,
      });
    }
  }

  return issues;
}

function extractSentences(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

function containsHighRiskClaim(sentence: string) {
  return /\b(?:launched|raised|revenue|ARR|MRR|users|customers|Stripe|OpenAI|GitHub|\d+(?:\.\d+)?[%x]?)\b/i.test(sentence);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function significantTerms(value: string) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "were", "was", "are", "has", "have"]);

  return value.split(" ").filter((term) => term.length > 3 && !stop.has(term));
}
