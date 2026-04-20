// Standalone assertion-style tests for the model-name parser. No framework
// dependency — run with: `npx tsx lib/model-parse.test.ts` from the frontend
// dir. Exits non-zero on any failure so it can be wired into a precommit hook
// or CI later without adjustments.
//
// The parser is intentionally best-effort; we're pinning current behavior for
// the names we actually see in the Crucible model library so regex tweaks
// don't silently regress the chip display.

import { parseModelName } from "./model-parse";

type Expect = {
  family?: string | null;
  params?: string | null;
  variant?: string | null;
  quant?: string | null;
};

type Case = { name: string; expect: Expect; note?: string };

const CASES: Case[] = [
  // Qwen3 family — code + instruct + VL variants
  { name: "Qwen3-Coder-Next-MLX-6bit",
    expect: { family: "Qwen3", params: null, variant: "Coder", quant: "6bit" } },
  { name: "Qwen3-Coder-30B-A3B-Instruct-MLX-8bit",
    expect: { family: "Qwen3", params: "30B·A3B", variant: "Coder", quant: "8bit" } },
  { name: "Qwen3-4B-Instruct-2507-MLX-4bit",
    expect: { family: "Qwen3", params: "4B", variant: "Instruct", quant: "4bit" } },

  // Qwen3.5 family — 27B distilled, 35B MoE, 122B VL
  { name: "Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-6bit",
    expect: { family: "Qwen3.5", params: "27B", variant: "Distilled", quant: "6bit" } },
  { name: "Qwen3.5-35B-A3B-8bit",
    expect: { family: "Qwen3.5", params: "35B·A3B", quant: "8bit" } },
  { name: "Qwen3.5-VL-122B-A10B-4bit-MLX-CRACK",
    expect: { family: "Qwen3.5", params: "122B·A10B", variant: "VL", quant: "4bit" } },

  // gpt-oss — MXFP weight-quant takes precedence over Q-suffix cache quant
  { name: "gpt-oss-20b-MXFP4-Q8",
    expect: { family: "gpt-oss", params: "20B", variant: null, quant: "MXFP4" } },

  // Qwen2.5 — abliterated variant + GGUF-style Q8_0 quant
  { name: "Qwen2.5-Coder-14B-Instruct-abliterated-Q8_0",
    expect: { family: "Qwen2.5", params: "14B", variant: "Coder", quant: "Q8_0" } },

  // Odd-ball — no canonical family prefix
  { name: "MiniMax-M2.7-JANG_2L",
    expect: { family: "MiniMax-M2.7", params: null, variant: null, quant: null } },

  // ── Expanded coverage: more Qwen3 / Qwen3.5 / Qwen3.6 variants ───────────
  { name: "Qwen3.6-35B-A3B-mlx-mxfp8",
    expect: { family: "Qwen3.6", params: "35B·A3B", quant: "MXFP8" } },
  { name: "Qwen3.6-35B-A3B-MLX-8bit",
    expect: { family: "Qwen3.6", params: "35B·A3B", quant: "8bit" } },
  { name: "Qwen3.6-35B-A3B-4bit",
    expect: { family: "Qwen3.6", params: "35B·A3B", quant: "4bit" } },
  { name: "Qwen3.5-27B-4bit",
    expect: { family: "Qwen3.5", params: "27B", quant: "4bit" } },
  { name: "Qwen3.5-VL-4B-8bit-MLX-CRACK",
    expect: { family: "Qwen3.5", params: "4B", variant: "VL", quant: "8bit" } },
  { name: "Qwen3-Coder-Next-MLX-4bit",
    expect: { family: "Qwen3", variant: "Coder", quant: "4bit" } },
  { name: "Qwen3-Coder-30B-A3B-DFlash",
    // A3B suffix sticks to params; DFlash tagged as variant — it's a draft model.
    expect: { family: "Qwen3", params: "30B·A3B", variant: "Coder" } },
  { name: "Qwen3.5-35B-A3B-DFlash",
    expect: { family: "Qwen3.5", params: "35B·A3B" } },

  // Llama / Mistral / Phi — common public model families that people drop
  // into the MLX dir. Parser should identify the family + params + quant.
  { name: "Llama-3.2-8B-Instruct-MLX-4bit",
    expect: { family: "Llama-3.2", params: "8B", variant: "Instruct", quant: "4bit" } },
  { name: "Llama-3.3-70B-Instruct-MLX-4bit",
    expect: { family: "Llama-3.3", params: "70B", variant: "Instruct", quant: "4bit" } },
  { name: "Mistral-7B-Instruct-v0.3-MLX-4bit",
    expect: { family: "Mistral", params: "7B", variant: "Instruct", quant: "4bit" } },
  { name: "Phi-3.5-mini-Instruct-MLX-4bit",
    expect: { family: "Phi-3.5", variant: "Instruct", quant: "4bit" } },

  // GGUF — naming tends to be lowercase with underscores, different quant tag.
  { name: "Qwen3.5-9B-Q6_K",
    expect: { family: "Qwen3.5", params: "9B", quant: "Q6_K" } },
  { name: "Qwen2.5-Coder-7B-Instruct-Q4_K_M",
    expect: { family: "Qwen2.5", params: "7B", variant: "Coder", quant: "Q4_K_M" } },
  // Parser normalizes family to title-case on first letter — lowercase input
  // comes through as "Llama-3.2".
  { name: "llama-3.2-3b-instruct-Q8_0",
    expect: { family: "Llama-3.2", params: "3B", variant: "Instruct", quant: "Q8_0" } },

  // int-prefix quant — rare but showed up on older MLX releases.
  { name: "SomeModel-8B-int4",
    expect: { family: "SomeModel", params: "8B", quant: "int4" } },

  // Multi-quant ambiguity — prefer the most specific. MXFP-style wins over
  // generic bit-count because it encodes the underlying scheme.
  { name: "gpt-oss-20b-MXFP4",
    expect: { family: "gpt-oss", params: "20B", quant: "MXFP4" } },

  // Family with a version dot but no micro — e.g. `Qwen2` without minor.
  { name: "Qwen2-7B-Instruct-Q4_K_M",
    expect: { family: "Qwen2", params: "7B", variant: "Instruct", quant: "Q4_K_M" } },
];

// fallbackQuant path — parser should prefer the passed-in quant over any
// regex-derived one if the caller supplied it.
const FALLBACK_QUANT_CASE = {
  name: "SomeModel-7B",
  fallbackQuant: "6bit",
  expect: { family: "SomeModel", params: "7B", variant: null, quant: "6bit" },
} as const;

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL ${label}: expected ${e}, got ${a}`);
  }
}

for (const c of CASES) {
  const got = parseModelName(c.name);
  const exp = { family: null, params: null, variant: null, quant: null, ...c.expect };
  console.log(`  ${c.name}`);
  check("family",  got.family,  exp.family);
  check("params",  got.params,  exp.params);
  check("variant", got.variant, exp.variant);
  check("quant",   got.quant,   exp.quant);
}

{
  const got = parseModelName(FALLBACK_QUANT_CASE.name, FALLBACK_QUANT_CASE.fallbackQuant);
  const exp = FALLBACK_QUANT_CASE.expect;
  console.log(`  ${FALLBACK_QUANT_CASE.name} (fallbackQuant)`);
  check("family",  got.family,  exp.family);
  check("params",  got.params,  exp.params);
  check("variant", got.variant, exp.variant);
  check("quant",   got.quant,   exp.quant);
}

const total = passed + failed;
if (failed > 0) {
  console.error(`\n✗ ${failed} / ${total} checks failed`);
  process.exit(1);
}
console.log(`\n✓ all ${total} checks passed`);
