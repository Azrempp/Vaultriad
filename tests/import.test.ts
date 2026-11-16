import { describe, it, expect } from "vitest";
import { parseImport, categorize } from "../src/main/import";
describe("export parsers", () => {
  const fixtures = [
    [
      "Chrome/Edge",
      "name,url,username,password\nExample,https://example.com,alice,s3cret",
    ],
    [
      "Firefox",
      "url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://example.com,alice,s3cret,,,,,,",
    ],
    [
      "Bitwarden CSV",
      "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Example,,,,https://example.com,alice,s3cret,",
    ],
    [
      "1Password CSV",
      "Title,Url,Username,Password,Notes,Type\nExample,https://example.com,alice,s3cret,hello,login",
    ],
    [
      "LastPass",
      "url,username,password,extra,name,grouping,fav\nhttps://example.com,alice,s3cret,hello,Example,,",
    ],
    [
      "KeePass",
      "Account,Login Name,Password,Web Site,Comments\nExample,alice,s3cret,https://example.com,hello",
    ],
    [
      "generic",
      "title,email,secret,website\nExample,alice,s3cret,https://example.com",
    ],
  ];
  for (const [format, raw] of fixtures)
    it(`parses ${format}`, () => {
      const { rows } = parseImport(raw);
      expect(rows).toHaveLength(1);
      expect(rows[0].secret).toBe("s3cret");
      expect(rows[0].username).toBe("alice");
      expect(rows[0].location).toBe("https://example.com");
      expect(rows[0].category).toBe("domains");
    });
  it("parses Bitwarden JSON nested login and URI", () => {
    const { rows } = parseImport(
      JSON.stringify({
        items: [
          {
            name: "Example",
            login: {
              username: "alice",
              password: "s3cret",
              uris: [{ uri: "https://example.com" }],
            },
          },
        ],
      }),
    );
    expect(rows[0]).toMatchObject({
      name: "Example",
      username: "alice",
      secret: "s3cret",
      location: "https://example.com",
    });
  });
  it("parses Firefox and 1Password JSON", () => {
    expect(
      parseImport(
        JSON.stringify({
          logins: [
            {
              hostname: "https://example.com",
              username: "alice",
              password: "s3cret",
            },
          ],
        }),
      ).rows[0].secret,
    ).toBe("s3cret");
    expect(
      parseImport(
        JSON.stringify({
          items: [
            {
              title: "Example",
              fields: [
                { id: "username", value: "alice" },
                { id: "password", value: "s3cret" },
              ],
              urls: [{ href: "https://example.com" }],
            },
          ],
        }),
      ).rows[0],
    ).toMatchObject({ username: "alice", secret: "s3cret" });
  });
  it("supports quoted CSV, BOM, manual mapping and skips missing secrets", () => {
    const p = parseImport(
      '\uFEFFtitle,custom,notes\n"Example, personal",secret,"a\nb"',
      { secret: "custom" },
    );
    expect(p.rows[0].name).toBe("Example, personal");
    expect(p.rows[0].notes).toBe("a\nb");
    expect(parseImport("name,password\nEmpty,").rows[0].skip).toBe(true);
  });
  it("categorizes cautiously and leaves ambiguous records for review", () => {
    expect(categorize("Router", "https://192.168.1.1", "pass")).toBe(
      "hardware",
    );
    expect(categorize("OpenAI", "https://example.com", "sk-abc")).toBe("api");
    expect(categorize("Unknown", "", "pass")).toBe("unsorted");
  });
});

it("rejects encrypted Firefox profile data instead of treating ciphertext as a password", () => {
  expect(() =>
    parseImport(
      JSON.stringify({
        logins: [
          {
            hostname: "https://example.com",
            encryptedUsername: "ciphertext",
            encryptedPassword: "ciphertext",
          },
        ],
      }),
    ),
  ).toThrow(/Firefox/);
});
