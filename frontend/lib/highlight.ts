// Tiny no-dep syntax highlighter for fenced code blocks in chat.
//
// Goal: make code outputs feel professional without dragging in highlight.js
// or shiki (10s of KB minified, multiple async chunks). We HTML-escape the
// source, then run a small set of regex replacements to wrap tokens in
// classed <span>s the chat dark theme already supports.
//
// Languages with first-class coverage: ts/tsx, js/jsx, python, json, bash,
// css, html, markdown, sql, go, rust, yaml. Everything else falls through
// as plain HTML-escaped text.

const LANG_ALIAS: Record<string, string> = {
  js: "ts",
  jsx: "ts",
  tsx: "ts",
  typescript: "ts",
  javascript: "ts",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  golang: "go",
  rs: "rust",
  md: "markdown",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Apply a list of token rules in order. Each rule replaces matches with a
// span; the regex is run on already-escaped text so HTML in the source is
// already inert. We use marker tokens to avoid re-tokenizing inside spans.
type Rule = { re: RegExp; cls: string };

const HL: Record<string, { keywords?: string[]; rules: Rule[] }> = {
  ts: {
    keywords: [
      "const", "let", "var", "function", "return", "if", "else", "for", "while",
      "do", "switch", "case", "break", "continue", "default", "try", "catch",
      "finally", "throw", "new", "delete", "typeof", "instanceof", "in", "of",
      "class", "extends", "super", "this", "import", "from", "export", "default",
      "async", "await", "yield", "void", "null", "true", "false", "undefined",
      "interface", "type", "enum", "namespace", "implements", "readonly", "as",
      "public", "private", "protected", "static", "abstract", "is",
    ],
    rules: [
      { re: /\/\/[^\n]*/g, cls: "hl-comment" },
      { re: /\/\*[\s\S]*?\*\//g, cls: "hl-comment" },
      { re: /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
    ],
  },
  python: {
    keywords: [
      "def", "class", "return", "if", "elif", "else", "for", "while", "break",
      "continue", "pass", "try", "except", "finally", "raise", "with", "as",
      "import", "from", "yield", "lambda", "global", "nonlocal", "in", "not",
      "and", "or", "is", "True", "False", "None", "async", "await", "match", "case",
    ],
    rules: [
      { re: /#[^\n]*/g, cls: "hl-comment" },
      { re: /(?:[ru]|rb|br)?(?:'''[\s\S]*?'''|"""[\s\S]*?""")/g, cls: "hl-string" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
    ],
  },
  json: {
    rules: [
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1\s*:/g, cls: "hl-key" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b(true|false|null)\b/g, cls: "hl-keyword" },
      { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: "hl-num" },
    ],
  },
  bash: {
    keywords: ["if", "then", "else", "elif", "fi", "case", "esac", "for", "in", "do", "done", "while", "until", "function", "return", "exit", "local", "export", "set", "unset", "echo", "cd", "pwd", "ls", "true", "false"],
    rules: [
      { re: /#[^\n]*/g, cls: "hl-comment" },
      { re: /"(?:\\.|[^"\\])*"/g, cls: "hl-string" },
      { re: /'(?:\\.|[^'\\])*'/g, cls: "hl-string" },
      { re: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, cls: "hl-var" },
      { re: /\b\d+\b/g, cls: "hl-num" },
    ],
  },
  css: {
    rules: [
      { re: /\/\*[\s\S]*?\*\//g, cls: "hl-comment" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /[#.][\w-]+/g, cls: "hl-keyword" },
      { re: /-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\b/g, cls: "hl-num" },
    ],
  },
  html: {
    rules: [
      { re: /&lt;!--[\s\S]*?--&gt;/g, cls: "hl-comment" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /&lt;\/?([a-zA-Z][\w-]*)/g, cls: "hl-keyword" },
    ],
  },
  markdown: {
    rules: [
      { re: /^#{1,6}\s.+$/gm, cls: "hl-keyword" },
      { re: /\*\*[^*\n]+\*\*/g, cls: "hl-keyword" },
      { re: /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
    ],
  },
  sql: {
    keywords: [
      "select", "from", "where", "join", "left", "right", "inner", "outer", "on",
      "as", "and", "or", "not", "in", "is", "null", "group", "by", "order",
      "having", "limit", "offset", "insert", "into", "values", "update", "set",
      "delete", "create", "table", "drop", "alter", "add", "column", "primary",
      "key", "foreign", "references", "with", "case", "when", "then", "else",
      "end", "distinct", "union", "all", "exists", "between", "like", "asc", "desc",
    ],
    rules: [
      { re: /--[^\n]*/g, cls: "hl-comment" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
    ],
  },
  go: {
    keywords: [
      "package", "import", "func", "var", "const", "type", "struct", "interface",
      "return", "if", "else", "for", "range", "switch", "case", "default", "go",
      "defer", "select", "chan", "map", "break", "continue", "fallthrough",
      "true", "false", "nil", "iota",
    ],
    rules: [
      { re: /\/\/[^\n]*/g, cls: "hl-comment" },
      { re: /\/\*[\s\S]*?\*\//g, cls: "hl-comment" },
      { re: /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
    ],
  },
  rust: {
    keywords: [
      "fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl",
      "for", "while", "loop", "if", "else", "match", "return", "break", "continue",
      "use", "mod", "pub", "crate", "self", "Self", "super", "as", "where",
      "async", "await", "move", "ref", "true", "false", "in", "dyn", "type",
      "unsafe", "extern",
    ],
    rules: [
      { re: /\/\/[^\n]*/g, cls: "hl-comment" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
    ],
  },
  yaml: {
    rules: [
      { re: /#[^\n]*/g, cls: "hl-comment" },
      { re: /^[\s-]*([A-Za-z0-9_-]+)\s*:/gm, cls: "hl-key" },
      { re: /(['"])(?:\\.|(?!\1)[^\\\n])*\1/g, cls: "hl-string" },
      { re: /\b\d+(?:\.\d+)?\b/g, cls: "hl-num" },
      { re: /\b(true|false|null|yes|no|on|off)\b/gi, cls: "hl-keyword" },
    ],
  },
};

// Spans are placed via a "protect" trick: each match is replaced with a
// sentinel \x00<idx>\x00, the slots are stored, then we restore them at the
// end so the keyword pass doesn't tokenize text already inside a span.
export function highlight(code: string, rawLang?: string): string {
  const escaped = esc(code);
  const lang = rawLang ? (LANG_ALIAS[rawLang.toLowerCase()] ?? rawLang.toLowerCase()) : "";
  const cfg = HL[lang];
  if (!cfg) return escaped;

  const slots: string[] = [];
  let out = escaped;
  for (const rule of cfg.rules) {
    out = out.replace(rule.re, (m) => {
      slots.push(`<span class="${rule.cls}">${m}</span>`);
      return `\x00${slots.length - 1}\x00`;
    });
  }
  if (cfg.keywords && cfg.keywords.length > 0) {
    const kwRe = new RegExp(`\\b(${cfg.keywords.join("|")})\\b`, "g");
    out = out.replace(kwRe, (m) => {
      slots.push(`<span class="hl-keyword">${m}</span>`);
      return `\x00${slots.length - 1}\x00`;
    });
  }
  return out.replace(/\x00(\d+)\x00/g, (_, i) => slots[Number(i)]);
}
