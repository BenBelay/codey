export const BAD_SITE_HOSTS = Object.freeze([
  "instagram.com",
  "tiktok.com",
  "x.com",
  "youtube.com"
]);

export function getReaction(pageContext, blockedSites = BAD_SITE_HOSTS) {
  if (isBadSite(pageContext?.hostname, blockedSites)) {
    return {
      mood: "rage",
      reason: "bad-site",
      badSite: true
    };
  }

  return {
    mood: "neutral",
    reason: pageContext?.siteCategory || "general",
    badSite: false
  };
}

export function isBadSite(hostname, blockedSites = BAD_SITE_HOSTS) {
  const normalized = String(hostname || "").toLowerCase();

  return normalizeBlockedSites(blockedSites).some((badHost) => {
    return normalized === badHost || normalized.endsWith(`.${badHost}`);
  });
}

export function normalizeBlockedSites(blockedSites = BAD_SITE_HOSTS) {
  const normalized = Array.isArray(blockedSites) ? blockedSites : BAD_SITE_HOSTS;
  const unique = new Set();

  for (const site of normalized) {
    const host = normalizeHost(site);
    if (host) {
      unique.add(host);
    }
  }

  return Array.from(unique).sort();
}

export function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/^\.+|\.+$/g, "");
}
