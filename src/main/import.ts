import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import type { Category, ImportRow } from "../shared/types";
const aliases: Record<string, string[]> = {
  name: ["name", "title", "account", "servicename"],
  username: [
    "username",
    "user",
    "login",
    "email",
    "loginusername",
    "loginname",
  ],
  location: [
    "url",
    "website",
    "uri",
    "hostname",
    "loginuri",
    "loginurl",
    "web_site",
  ],
  secret: ["password", "pass", "secret", "token", "key", "loginpassword"],
  notes: ["notes", "note", "extra", "comments"],
};
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function flatten(item: any): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (v: any, p = "") => {
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [k, val] of Object.entries(v)) visit(val, p + k);
    else if (typeof v === "string" || typeof v === "number")
      result[p] = String(v);
  };
  visit(item);
  if (item.login?.uris?.[0]?.uri) result.url = item.login.uris[0].uri;
  if (Array.isArray(item.fields))
    for (const field of item.fields) {
      if (field.id === "password" || field.purpose === "PASSWORD")
        result.password = field.value;
      if (field.id === "username" || field.purpose === "USERNAME")
        result.username = field.value;
    }
  if (Array.isArray(item.urls) && item.urls[0]?.href)
    result.url = item.urls[0].href;
  return result;
}
export function categorize(
  name: string,
  location: string,
  secret: string,
): Category | "unsorted" {
  const text = `${name} ${location}`;
  if (/router|wi-?fi|server|bios|\bnas\b|camera|smart home/i.test(text))
    return "hardware";
  if (
    /\bapi\b|token|ssh|\bcli\b/i.test(text) ||
    /^(sk-|ghp_|github_pat_|AKIA)/.test(secret) ||
    (/^[a-zA-Z0-9]{32,}$/.test(secret) && !location)
  )
    return "api";
  if (/https?:\/\/|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(location)) return "domains";
  return "unsorted";
}
export function parseImport(raw: string, overrides?: Record<string, string>) {
  let records: Record<string, string>[],
    format = "CSV";
  if (/^[\s]*[\[{]/.test(raw)) {
    const json = JSON.parse(raw);
    const items = Array.isArray(json)
      ? json
      : json.items || json.logins || json.entries || json.accounts;
    if (!Array.isArray(items))
      throw Error(
        "JSON must contain an array of entries or an items/logins/entries/accounts array.",
      );
    if (
      items.some(
        (item: any) => item?.encryptedPassword || item?.encryptedUsername,
      )
    )
      throw Error(
        "Encrypted Firefox profiles are not password exports. Export passwords as CSV first.",
      );
    records = items.map(flatten);
    format = "JSON";
  } else {
    const parsed = Papa.parse<Record<string, string>>(raw, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
    });
    if (
      parsed.errors.some(
        (e) => e.type === "Quotes" || e.type === "FieldMismatch",
      )
    )
      throw Error(
        "CSV contains malformed quotes or inconsistent column counts. Check the source export.",
      );
    records = parsed.data;
  }
  if (records.length > 10000)
    throw Error("Import at most 10,000 entries at a time.");
  const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const mapping: Record<string, string> = {};
  for (const [target, names] of Object.entries(aliases)) {
    mapping[target] =
      overrides?.[target] ??
      headers.find((h) => names.map(clean).includes(clean(h))) ??
      headers.find((h) => names.some((n) => clean(h).endsWith(clean(n)))) ??
      "";
  }
  const rows: ImportRow[] = records.map((r) => {
    const values = Object.values(r).filter((v) => typeof v === "string");
    const get = (t: string) => r[mapping[t]] || "";
    const location =
      get("location") || values.find((v) => /^https?:\/\//i.test(v)) || "";
    const username =
      get("username") ||
      values.find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ||
      "";
    const secret =
      get("secret") ||
      values.find((v) => /^(sk-|ghp_|AKIA)/.test(v)) ||
      values.find(
        (v) =>
          v.length >= 24 &&
          !/\s|@|https?:\/\//i.test(v) &&
          /[A-Za-z]/.test(v) &&
          /[0-9]/.test(v),
      ) ||
      "";
    const name = get("name") || location || username || "Untitled import";
    return {
      id: randomUUID(),
      name,
      username,
      location,
      secret,
      notes: get("notes"),
      category: categorize(name, location, secret),
      skip: !secret,
      resolution: "keep",
      unmapped: headers.filter(
        (h) => !Object.values(mapping).includes(h) && r[h],
      ),
    };
  });
  return { rows, headers, mapping, format };
}
