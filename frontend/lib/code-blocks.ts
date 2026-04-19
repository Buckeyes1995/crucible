// Extract fenced code blocks from markdown output and auto-name each one.
//
// Matches ```lang, ```lang:filename.ext, and ```filename.ext variants. The
// filename rules are intentionally conservative — we prefer an explicit hint
// in the fence, fall back to a sensible per-language default, and never
// preserve user-supplied paths (the backend sandbox strips them anyway).

const LANG_TO_EXT: Record<string, string> = {
  html: "html",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  zsh: "sh",
  shell: "sh",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  rust: "rs",
  rs: "rs",
  go: "go",
  java: "java",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  ruby: "rb",
  rb: "rb",
  php: "php",
  md: "md",
  markdown: "md",
  kotlin: "kt",
  kt: "kt",
  dart: "dart",
  r: "r",
};

export type CodeBlock = {
  /** Suggested filename, sanitized — never contains path separators. */
  filename: string;
  /** Best-guess language label (empty if absent). */
  lang: string;
  /** Raw body, trimmed of surrounding whitespace. */
  content: string;
};

function sanitizeName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, 128);
}

/** Parse `text` and return every fenced code block with a suggested filename. */
export function extractCodeBlocks(text: string, prefix = "out"): CodeBlock[] {
  const out: CodeBlock[] = [];
  // Match opening fence + optional lang/filename, then everything up to
  // the matching closing fence on its own line.
  const re = /```([\w+\-./:]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    idx += 1;
    const header = (m[1] ?? "").trim();
    const content = (m[2] ?? "").replace(/\s+$/, "");
    if (!content) continue;

    let lang = "";
    let filename = "";

    if (header.includes(":")) {
      // ```lang:filename.ext
      const [h1, h2] = header.split(":", 2);
      lang = h1.toLowerCase();
      filename = sanitizeName(h2.split("/").pop() ?? "");
    } else if (header.includes(".")) {
      // ```filename.ext
      filename = sanitizeName(header.split("/").pop() ?? "");
      const dot = filename.lastIndexOf(".");
      if (dot >= 0) lang = filename.slice(dot + 1).toLowerCase();
    } else {
      lang = header.toLowerCase();
    }

    if (!filename) {
      const ext = LANG_TO_EXT[lang] ?? (lang || "txt");
      filename = `${prefix}-${idx}.${ext}`;
    }
    out.push({ filename, lang, content });
  }
  return out;
}
