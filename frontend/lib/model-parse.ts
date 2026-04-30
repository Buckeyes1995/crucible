// Best-effort parser for model directory names into display chips.
// Model names are wildly inconsistent across publishers — we try a few
// regex rules and fall back to the raw name in the Full ID row if nothing
// catches. The parser never throws; unknowns just return empty fields.

// Strip noise from a model name for display: drop directory prefixes
// (e.g. "Qwen3-1.7B-GGUF/Qwen3-1.7B-Q6_K" → "Qwen3-1.7B-Q6_K"),
// shard suffixes ("…-00001-of-00004"), and trailing ".gguf"/".safetensors"
// extensions. Returns the cleaned base name only.
export function cleanModelName(raw: string): string {
  if (!raw) return raw;
  // Last path segment only — directory parts are noise on the card.
  let s = raw.split("/").pop() ?? raw;
  // Drop file extension if it leaked in.
  s = s.replace(/\.(gguf|safetensors|bin)$/i, "");
  // Strip shard suffixes: "-00001-of-00004" or ".00001-of-00004".
  s = s.replace(/[-.]\d{3,5}-of-\d{3,5}$/i, "");
  return s;
}

export type ParsedModel = {
  family: string | null;    // e.g. "Qwen3.5", "gpt-oss", "Llama-3"
  params: string | null;    // e.g. "30B", "7B·A3B" for MoE, "20B"
  variant: string | null;   // e.g. "Coder", "Instruct", "VL", "Distilled"
  quant: string | null;     // e.g. "6bit", "Q8_0", "MXFP4"
};

// Known family prefixes — matched first so "Qwen3.5-Coder" pulls "Qwen3.5" not "Qwen3.5-Coder"
const FAMILY_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /^(Qwen[\d.]+)/i,        name: "Qwen" },
  { re: /^(Llama-?[\d.]+)/i,     name: "Llama" },
  { re: /^(Mistral[\d.]*)/i,     name: "Mistral" },
  { re: /^(Mixtral[\d.]*)/i,     name: "Mixtral" },
  { re: /^(DeepSeek[\w-]*)/i,    name: "DeepSeek" },
  { re: /^(Phi-?[\d.]+)/i,       name: "Phi" },
  { re: /^(gpt-oss)/i,           name: "gpt-oss" },
  { re: /^(gemma-?[\d.]*)/i,     name: "Gemma" },
  { re: /^(MiniMax-?[\w.]*)/i,   name: "MiniMax" },
  { re: /^(Yi-?[\d.]*)/i,        name: "Yi" },
  { re: /^(Hermes-?[\d.]*)/i,    name: "Hermes" },
];

const VARIANT_KEYWORDS = [
  "Coder", "Instruct", "Chat", "VL", "Vision", "Distilled",
  "Next", "Thinking", "Reasoner", "RL", "abliterated", "CRACK",
];

// Param size: "30B", "7B", "4b", "20b", "122B", and MoE "A3B" / "A10B"
const PARAMS_RE = /\b(\d+\.?\d*)([BMbm])(?:-A(\d+\.?\d*)([BMbm]))?\b/;
// Quant forms: "4bit", "6bit", "Q8_0", "Q4_K_M", "MXFP4", "mxfp8", "FP8",
// "int4". Ordered: weight-quant styles first (bit, MXFP, FP, int), then
// GGUF cache-quant suffix (Q\d) last — for "MXFP4-Q8" the weight quant
// MXFP4 is what users care about, not the Q8 KV cache.
const QUANT_RES = [
  /\b(\d+)\s*bit\b/i,
  /\b(MXFP\d+)\b/i,
  /\b(FP\d+)\b/i,
  /\b(int\d+)\b/i,
  // Allow multiple _SUFFIX chunks so "Q4_K_M" and similar match in full.
  /\b(Q\d+(?:_[0-9A-Z]+){0,3})\b/,
];

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function parseModelName(name: string, fallbackQuant?: string | null): ParsedModel {
  // Strip suffixes that are noise in the chip row (we keep the full name at bottom)
  const cleaned = name.replace(/\s+/g, "-");

  // ─── family ───────────────────────────────────────────────────────────────
  let family: string | null = null;
  for (const rule of FAMILY_RULES) {
    const m = cleaned.match(rule.re);
    if (m) {
      family = m[1];
      // Normalize common casing
      if (/^gpt-oss$/i.test(family)) family = "gpt-oss";
      else if (/^qwen/i.test(family)) family = "Qwen" + family.slice(4);
      else if (/^llama/i.test(family)) family = "Llama" + family.slice(5);
      break;
    }
  }
  // Fallback: first hyphen-segment, capitalized
  if (!family) {
    const first = cleaned.split(/[-_/]/)[0];
    if (first && first.length <= 12) family = titleCase(first);
  }

  // ─── params ───────────────────────────────────────────────────────────────
  let params: string | null = null;
  const pm = cleaned.match(PARAMS_RE);
  if (pm) {
    const main = `${pm[1]}${pm[2].toUpperCase()}`;
    params = pm[3] ? `${main}·A${pm[3]}${pm[4].toUpperCase()}` : main;
  }

  // ─── variant ──────────────────────────────────────────────────────────────
  let variant: string | null = null;
  for (const kw of VARIANT_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(cleaned)) {
      variant = kw === "abliterated" ? "abliterated" : titleCase(kw.toLowerCase());
      if (kw === "VL") variant = "VL";
      if (kw === "CRACK") variant = "CRACK";
      break;
    }
  }

  // ─── quant ────────────────────────────────────────────────────────────────
  let quant: string | null = null;
  if (fallbackQuant) quant = fallbackQuant;
  else {
    for (const re of QUANT_RES) {
      const m = cleaned.match(re);
      if (m) {
        const raw = m[1];
        // Normalize casing per scheme so chips read consistently regardless
        // of whether the directory used UPPER, lower, or MiXeD conventions.
        if (/^mxfp/i.test(raw)) quant = raw.toUpperCase();
        else if (/^fp/i.test(raw) && !/^fpga/i.test(raw)) quant = raw.toUpperCase();
        else if (/^int/i.test(raw)) quant = raw.toLowerCase();
        else if (/^q\d/i.test(raw)) quant = raw.toUpperCase();
        else if (/bit$/i.test(m[0])) quant = `${raw}bit`;
        else quant = raw;
        break;
      }
    }
  }

  return { family, params, variant, quant };
}
