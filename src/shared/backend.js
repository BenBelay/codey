const MAX_RESPONSE_WORDS = 100;

export async function sendMessageToCompanion({ url, title, userMessage, pageContext }) {
  const cleanMessage = String(userMessage || "").trim();

  if (!cleanMessage) {
    return {
      text: "Ask me something about this page."
    };
  }

  const context = normalizePageContext(pageContext, { url, title });
  const answer = answerFromPageContext(cleanMessage, context);

  return {
    text: limitWords(answer, MAX_RESPONSE_WORDS)
  };
}

function normalizePageContext(pageContext, fallback) {
  const context = pageContext && typeof pageContext === "object" ? pageContext : {};

  return {
    url: context.url || fallback.url || "",
    title: context.title || fallback.title || "",
    hostname: context.hostname || "",
    description: context.description || "",
    headings: Array.isArray(context.headings) ? context.headings.filter(Boolean).slice(0, 24) : [],
    visibleText: context.visibleText || ""
  };
}

function answerFromPageContext(userMessage, context) {
  const normalizedQuestion = userMessage.toLowerCase();

  if (asksForSummary(normalizedQuestion)) {
    return summarizePage(context);
  }

  const relevant = findRelevantText(userMessage, context.visibleText);
  if (relevant) {
    return relevant;
  }

  const generalAnswer = answerGeneralQuestion(normalizedQuestion, context);
  if (generalAnswer) {
    return generalAnswer;
  }

  const fallbackDetails = [
    context.description,
    context.headings.length ? `Sections I can see include ${context.headings.slice(0, 8).join(", ")}.` : "",
    context.title ? `The page title is "${context.title}".` : ""
  ].filter(Boolean).join(" ");

  return fallbackDetails || "I can see the page, but I do not have enough readable text to answer that yet.";
}

function asksForSummary(question) {
  return /\b(what is this page about|what's this page about|summari[sz]e|summary|about this page|what is this)\b/.test(question);
}

function summarizePage(context) {
  const parts = [];

  if (context.title) {
    parts.push(`This page is titled "${context.title}".`);
  }

  if (context.description) {
    parts.push(context.description);
  }

  const textSummary = summarizeVisibleText(context.visibleText);
  if (textSummary) {
    parts.push(textSummary);
  }

  if (context.headings.length) {
    parts.push(`Visible sections include ${context.headings.slice(0, 8).join(", ")}.`);
  }

  if (context.hostname) {
    parts.push(`It is on ${context.hostname}.`);
  }

  return parts.join(" ") || "I do not have enough readable page context to summarize it yet.";
}

function findRelevantText(userMessage, visibleText) {
  const sentences = splitSentences(visibleText);
  if (!sentences.length) {
    return "";
  }

  const keywords = String(userMessage || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, 8);

  if (!keywords.length) {
    return firstSentence(visibleText);
  }

  const scored = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      matches: keywords.filter((keyword) => sentence.toLowerCase().includes(keyword))
    }))
    .map((entry) => ({
      ...entry,
      score: entry.matches.length
    }))
    .filter((entry) => entry.score > 0);

  const coveredKeywords = new Set(scored.flatMap((entry) => entry.matches));
  const hasEnoughCoverage = keywords.length <= 1
    ? coveredKeywords.size >= 1
    : coveredKeywords.size >= Math.min(2, keywords.length);

  if (!hasEnoughCoverage) {
    return "";
  }

  const ranked = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index);

  return ranked.length ? ranked.map((entry) => entry.sentence).join(" ") : "";
}

function answerGeneralQuestion(question, context) {
  if (/^\s*(hi|hello|hey)\b/.test(question) && question.length <= 12) {
    return context.title
      ? `Hi. I can answer general questions and use context from "${context.title}".`
      : "Hi. I can answer general questions and use context from this page.";
  }

  if (/\bqueens?\s+gambit\b/.test(question)) {
    return [
      "The Queen's Gambit is a chess opening: 1.d4 d5 2.c4.",
      "White offers the c-pawn to pressure Black's center, speed development, and often build a strong pawn center.",
      context.hostname ? `Since you're on ${context.hostname}, this page may have lessons or puzzles to practice it.` : ""
    ].filter(Boolean).join(" ");
  }

  if (/\bwhat\s+is\b/.test(question) || /\bexplain\b/.test(question) || /\bhow\s+do\b/.test(question)) {
    return context.title
      ? `I can answer generally, but this local version has limited built-in knowledge. On this page, I can use "${context.title}" and visible text.`
      : "I can answer generally, but this local version has limited built-in knowledge. I can also use visible text from the current page.";
  }

  return "";
}

function firstSentence(text) {
  return splitSentences(text)[0] || "";
}

function summarizeVisibleText(text) {
  const sentences = splitSentences(text)
    .filter((sentence) => sentence.length >= 35)
    .filter((sentence) => !/^(cookie|sign in|log in|subscribe|advertisement)\b/i.test(sentence));

  return sentences.slice(0, 5).join(" ");
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 120);
}

function limitWords(text, maxWords) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]+$/, "")}...`;
}

const STOP_WORDS = new Set([
  "about",
  "this",
  "that",
  "with",
  "from",
  "what",
  "where",
  "when",
  "which",
  "page",
  "does",
  "have",
  "there"
]);
