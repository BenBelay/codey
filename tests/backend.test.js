import test from "node:test";
import assert from "node:assert/strict";
import { sendMessageToCompanion } from "../src/shared/backend.js";

test("sendMessageToCompanion summarizes page context instead of returning placeholder stub", async () => {
  const response = await sendMessageToCompanion({
    userMessage: "what is this page about?",
    pageContext: {
      title: "Example Product",
      hostname: "example.com",
      description: "A page about a browser companion extension.",
      headings: ["Overview", "Features"],
      visibleText: "Example Product Overview Features"
    }
  });

  assert.match(response.text, /Example Product/);
  assert.match(response.text, /browser companion extension/);
  assert.doesNotMatch(response.text, /I heard/);
  assert.ok(countWords(response.text) <= 100);
});

test("sendMessageToCompanion answers with relevant page text", async () => {
  const response = await sendMessageToCompanion({
    userMessage: "What features does it have?",
    pageContext: {
      title: "Example Product",
      visibleText: "Welcome. Features include page-aware chat, skins, and a clock accessory. Pricing is not listed."
    }
  });

  assert.match(response.text, /page-aware chat/);
  assert.ok(countWords(response.text) <= 100);
});

test("sendMessageToCompanion gives a concise page summary from visible text", async () => {
  const response = await sendMessageToCompanion({
    userMessage: "What is this page about?",
    pageContext: {
      title: "Transformers - Wikipedia",
      hostname: "en.wikipedia.org",
      headings: ["Plot", "Cast", "Production", "Reception"],
      visibleText: [
        "Transformers is a media franchise produced by American toy company Hasbro and Japanese toy company Takara Tomy.",
        "It primarily follows heroic Autobots and villainous Decepticons, two alien robot factions at war that can transform into other forms.",
        "The franchise began in the 1980s with toys, animated television, comic books, and later live-action films."
      ].join(" ")
    }
  });

  assert.match(response.text, /Transformers - Wikipedia/);
  assert.match(response.text, /media franchise/);
  assert.ok(countWords(response.text) <= 100);
});

test("sendMessageToCompanion returns concise relevant page text", async () => {
  const response = await sendMessageToCompanion({
    userMessage: "Tell me about pricing and features",
    pageContext: {
      title: "Example Product",
      visibleText: [
        "Welcome to the product page.",
        "Features include page-aware chat, skins, a clock accessory, and Pomodoro support.",
        "The pricing section says the starter plan is free and the team plan is paid.",
        "Support information appears later on the page."
      ].join(" ")
    },
    conversationHistory: [{
      role: "user",
      text: "What is this product?"
    }]
  });

  assert.match(response.text, /page-aware chat/);
  assert.doesNotMatch(response.text, /earlier question/);
  assert.ok(countWords(response.text) <= 100);
});

test("sendMessageToCompanion answers general chess questions instead of weak page chrome matches", async () => {
  const response = await sendMessageToCompanion({
    userMessage: "hi what is the queens gambit opening?",
    pageContext: {
      title: "Home - Chess.com",
      hostname: "chess.com",
      visibleText: [
        "Skip to content Play Puzzles Learn More Free Trial Search.",
        "Advanced Openings: Strike in the Center Start Lesson.",
        "Game Review Learn from your mistakes."
      ].join(" ")
    }
  });

  assert.match(response.text, /Queen's Gambit/);
  assert.match(response.text, /1\.d4 d5 2\.c4/);
  assert.doesNotMatch(response.text, /Skip to content/);
  assert.ok(countWords(response.text) <= 100);
});

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}
