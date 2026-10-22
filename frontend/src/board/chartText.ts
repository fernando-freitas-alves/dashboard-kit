/** Lowercase snake-case name for the CSV download. */
export const fileSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);

type SqlToken = {
  text: string;
  kind: "comment" | "string" | "number" | "word" | null;
};

const digit = (char: string) => char >= "0" && char <= "9";
const wordStart = (char: string) =>
  (char >= "A" && char <= "Z") ||
  (char >= "a" && char <= "z") || char === "_";
const word = (char: string) => wordStart(char) || digit(char);

/** Scan each character once, including unfinished comments and strings. */
export function* sqlTokens(query: string): Generator<SqlToken> {
  let cursor = 0;
  let plain = 0;
  while (cursor < query.length) {
    const start = cursor;
    const char = query[cursor];
    let kind: SqlToken["kind"] = null;
    if (char === "-" && query[cursor + 1] === "-") {
      const end = query.indexOf("\n", cursor + 2);
      cursor = end === -1 ? query.length : end;
      kind = "comment";
    } else if (char === "/" && query[cursor + 1] === "*") {
      const end = query.indexOf("*/", cursor + 2);
      cursor = end === -1 ? query.length : end + 2;
      kind = "comment";
    } else if (char === "'") {
      cursor++;
      while (cursor < query.length) {
        if (query[cursor++] !== "'") continue;
        if (query[cursor] !== "'") break;
        cursor++;
      }
      kind = "string";
    } else if (digit(char)) {
      while (digit(query[cursor])) cursor++;
      if (query[cursor] === "." && digit(query[cursor + 1])) {
        cursor++;
        while (digit(query[cursor])) cursor++;
      }
      if (wordStart(query[cursor])) {
        while (word(query[cursor])) cursor++;
      } else {
        kind = "number";
      }
    } else if (wordStart(char)) {
      while (word(query[cursor])) cursor++;
      kind = "word";
    } else {
      cursor++;
    }
    if (kind) {
      if (start > plain) yield { text: query.slice(plain, start), kind: null };
      yield { text: query.slice(start, cursor), kind };
      plain = cursor;
    }
  }
  if (plain < query.length) yield { text: query.slice(plain), kind: null };
}
