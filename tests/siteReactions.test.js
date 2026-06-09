import test from "node:test";
import assert from "node:assert/strict";
import { getReaction, isBadSite, normalizeBlockedSites, normalizeHost } from "../src/shared/siteReactions.js";

test("isBadSite matches configured bad hosts and subdomains", () => {
  assert.equal(isBadSite("instagram.com"), true);
  assert.equal(isBadSite("tiktok.com"), true);
  assert.equal(isBadSite("www.tiktok.com"), true);
  assert.equal(isBadSite("www.instagram.com"), true);
  assert.equal(isBadSite("x.com"), true);
  assert.equal(isBadSite("m.youtube.com"), true);
  assert.equal(isBadSite("notyoutube.com"), false);
  assert.equal(isBadSite("github.com"), false);
});

test("isBadSite matches custom user blocked sites", () => {
  assert.equal(isBadSite("docs.example.com", ["example.com"]), true);
  assert.equal(isBadSite("github.com", ["example.com"]), false);
});

test("getReaction returns rage mode on bad sites", () => {
  assert.deepEqual(getReaction({ hostname: "youtube.com", siteCategory: "video" }), {
    mood: "rage",
    reason: "bad-site",
    badSite: true
  });
});

test("getReaction uses custom blocked site preferences", () => {
  assert.deepEqual(getReaction({ hostname: "example.com", siteCategory: "general" }, ["example.com"]), {
    mood: "rage",
    reason: "bad-site",
    badSite: true
  });
});

test("getReaction returns neutral mode elsewhere", () => {
  assert.deepEqual(getReaction({ hostname: "example.com", siteCategory: "general" }), {
    mood: "neutral",
    reason: "general",
    badSite: false
  });
});

test("normalizeBlockedSites cleans URLs and removes duplicates", () => {
  assert.deepEqual(normalizeBlockedSites([
    "https://www.Example.com/path",
    "example.com",
    "x.com:443",
    ""
  ]), ["example.com", "x.com"]);
});

test("normalizeHost extracts a hostname from user input", () => {
  assert.equal(normalizeHost("https://www.tiktok.com/@openai"), "tiktok.com");
});
