export function getPageContext(doc = document, locationLike = window.location) {
  const url = locationLike.href;
  const hostname = locationLike.hostname || "";

  return {
    url,
    title: doc.title || "",
    hostname,
    description: getMetaContent(doc, "description") || getMetaProperty(doc, "og:description"),
    headings: getHeadings(doc),
    visibleText: getVisibleText(doc),
    siteCategory: detectSiteCategory(hostname),
    capturedAt: Date.now()
  };
}

export function detectSiteCategory(hostname) {
  const normalized = hostname.toLowerCase();

  if (normalized.includes("youtube.com") || normalized.includes("youtu.be")) {
    return "video";
  }

  if (normalized.includes("github.com")) {
    return "code";
  }

  if (normalized.includes("docs.google.com") || normalized.includes("notion.so")) {
    return "document";
  }

  return "general";
}

function getMetaContent(doc, name) {
  return doc.querySelector?.(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
}

function getMetaProperty(doc, property) {
  return doc.querySelector?.(`meta[property="${property}"]`)?.getAttribute("content")?.trim() || "";
}

function getHeadings(doc) {
  return Array.from(doc.querySelectorAll?.("h1, h2, h3") || [])
    .map((heading) => normalizeText(heading.textContent || ""))
    .filter(Boolean)
    .slice(0, 24);
}

function getVisibleText(doc) {
  const rawText = doc.body?.innerText || doc.body?.textContent || "";
  return normalizeText(rawText).slice(0, 50000);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
