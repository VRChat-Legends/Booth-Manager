"use strict";

function safeExternalUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)|%c2%[89][0-9a-f]/i.test(value) || value.includes("\\")) return "";
  try {
    const text = value.trim();
    const url = new URL(text);
    if (/^https?:\/\//i.test(text) && !url.username && !url.password) {
      const authority = text.slice(text.indexOf("//") + 2).split(/[/?#]/, 1)[0];
      return authority && !authority.includes("@") ? url.href : "";
    }
    if (url.protocol === "mailto:" && !url.hash) {
      if (/^mailto:\//i.test(text) || url.host) return "";
      const recipients = decodeURIComponent(url.pathname).split(",");
      if (recipients.some((address) => {
        const parts = address.split("@");
        return parts.length !== 2 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0])
          || !parts[1].split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
      })) return "";
      for (const [key, content] of url.searchParams) {
        if (!["subject", "body"].includes(key.toLowerCase()) || /[\u0000-\u001f\u007f-\u009f]/.test(content)) return "";
      }
      return url.href;
    }
    if (url.protocol === "vcc:" && /^vcc:\/\/vpm\//i.test(text) && url.hostname === "vpm" && !url.port && url.pathname === "/addRepo" && !url.username && !url.password && !url.hash) {
      if ([...url.searchParams.keys()].some((key) => key !== "url") || url.searchParams.getAll("url").length !== 1) return "";
      const rawRepo = url.searchParams.get("url");
      if (!/^https:\/\//i.test(rawRepo) || !safeExternalUrl(rawRepo)) return "";
      const repo = new URL(rawRepo);
      if (repo.origin === "https://vrchatlegends.com" && !repo.username && !repo.password) return url.href;
    }
  } catch {}
  return "";
}

module.exports = { safeExternalUrl };