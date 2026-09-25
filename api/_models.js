/**
 * Residual Continuum: free-model picker for OpenRouter
 * ------------------------------------------------------------------
 * Files that start with "_" are not deployed as endpoints; ask.js and
 * draft.js import this one.
 *
 * What it guarantees:
 * 1. Only free models are ever called. The live model list is filtered to
 *    models priced at exactly zero, and every request also carries a
 *    provider price cap of zero, so OpenRouter refuses rather than bills.
 * 2. New models are picked up without a redeploy. The list is read from
 *    OpenRouter's public catalogue and refreshed every 30 minutes, so a model
 *    released today is a candidate within the hour, and one withdrawn today
 *    simply drops out.
 * 3. No single model is a point of failure. Candidates are tried in ranked
 *    order, three at a time through OpenRouter's own fallback list; a model
 *    that errors, times out or returns unusable output is benched for a
 *    while; and the free router "openrouter/free" is the last resort.
 *
 * How "best" is judged, with no benchmark API to ask: general-purpose chat
 * models only (safety classifiers, coding, music, finance or health
 * specialists and tiny models are left out), then a score from the lab's
 * track record, model size and how recent the model is. Previews and
 * "stealth" models count, a little lower, because they can vanish.
 *
 * Optional environment variable:
 *   FREE_MODELS_PREFER  comma-separated model ids to try first. Ignored
 *                       unless the id is currently free.
 */

const LIST_URL = "https://openrouter.ai/api/v1/models";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const LIST_TTL = 30 * 60 * 1000;
const BENCH_MS = 15 * 60 * 1000;
const LAST_RESORT = "openrouter/free";

/* Used only if the catalogue cannot be read and nothing is cached. */
const SEED = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "qwen/qwen3.8-27b:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
];

/* Labs with a record of strong general models. Higher = preferred. */
const FAMILY = [
  [/deepseek/i, 30], [/nemotron[^/]*(ultra|super)/i, 28], [/qwen/i, 28],
  [/inkling(?!-small)/i, 27], [/kimi|moonshot/i, 27], [/gpt-oss|openai\//i, 26],
  [/glm|z-ai\//i, 26], [/minimax/i, 24], [/llama-?4|llama-3\.3-70b/i, 22],
  [/gemma-?[3-9]/i, 22], [/mistral|magistral/i, 20], [/hermes/i, 18],
  [/dots/i, 18], [/nemotron/i, 16], [/inkling-small/i, 16],
];
const EXCLUDE = /(safety|guard|moderation|embed|rerank|ocr|lyria|music|tts|whisper|coder|[-/]code|laguna|-fin\b|-fin:|-sante|-med\b|-med:|clip)/i;

let cache = { at: 0, list: null };
const benched = new Map(); // id -> benched until (ms)

const isFree = (m) => {
  const p = m.pricing || {};
  return ["prompt", "completion", "request"].every((k) => p[k] == null || Number(p[k]) === 0)
    && Number(p.prompt) === 0 && Number(p.completion) === 0;
};

function score(m, now) {
  const id = m.id;
  let s = 0;
  for (const [re, w] of FAMILY) if (re.test(id)) { s += w; break; }
  const b = id.match(/(\d+(?:\.\d+)?)b(?![a-z0-9])/i);
  if (b) {
    const size = parseFloat(b[1]);
    if (size < 12) return -1;                       /* too small to follow the rules reliably */
    s += Math.min(20, 6 * Math.log2(size / 8));
  } else s += 8;
  const ageMonths = (now / 1000 - (m.created || 0)) / (30 * 86400);
  s += Math.max(0, 10 - ageMonths * 0.6);
  if (/stealth|alpha|preview|beta|experimental/i.test(id)) s -= 12;
  return s;
}

async function fetchList() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(LIST_URL, { signal: ctl.signal });
    if (!r.ok) throw new Error(`models ${r.status}`);
    const all = (await r.json()).data || [];
    const now = Date.now();
    return all
      .filter((m) => m.id !== LAST_RESORT && isFree(m))
      .filter((m) => (m.context_length || 0) >= 16000)
      .filter((m) => {
        const a = m.architecture || {};
        const out = a.output_modalities || ["text"], inp = a.input_modalities || ["text"];
        return out.includes("text") && inp.includes("text") && !EXCLUDE.test(m.id);
      })
      .map((m) => ({ id: m.id, s: score(m, now) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id);
  } finally { clearTimeout(t); }
}

/** Ranked free model ids, best first, with benched models moved to the back. */
export async function freeModels() {
  const now = Date.now();
  if (!cache.list || now - cache.at > LIST_TTL) {
    try { const l = await fetchList(); if (l.length) cache = { at: now, list: l }; }
    catch (e) { if (!cache.list) cache = { at: now - LIST_TTL + 60_000, list: SEED.slice() }; }
  }
  let list = cache.list.slice();
  const prefer = String(process.env.FREE_MODELS_PREFER || "").split(",").map((s) => s.trim())
    .filter((id) => id && list.includes(id));
  list = [...prefer, ...list.filter((id) => !prefer.includes(id))];
  const ok = list.filter((id) => !(benched.get(id) > now));
  const bad = list.filter((id) => benched.get(id) > now);
  return [...ok, ...bad];
}

export function modelStatus() {
  const now = Date.now();
  return {
    updated: cache.at ? new Date(cache.at).toISOString() : null,
    ranked: (cache.list || []).slice(0, 12),
    benched: [...benched].filter(([, u]) => u > now).map(([id]) => id),
    last_resort: LAST_RESORT,
  };
}

const bench = (id, ms = BENCH_MS) => { if (id) benched.set(id, Date.now() + ms); };

/**
 * Run a chat completion on the best free model that returns usable output.
 * `parse(text)` must return the parsed value or throw; a throw moves on to
 * the next model. Returns { value, model }.
 */
export async function chatFree({ messages, temperature = 0.2, max_tokens = 900, parse, title,
  budgetMs = 28_000, perTryMs = 16_000, json = true }) {
  const start = Date.now();
  const tried = new Set();
  const ranked = await freeModels();
  let lastErr = "no free model available";

  let lastResort = false;
  for (let round = 0; round < 6 && !lastResort; round++) {
    const left = budgetMs - (Date.now() - start);
    if (left < 3000) break;
    let pool = ranked.filter((id) => !tried.has(id)).slice(0, 3);
    if (!pool.length || round === 5) { pool = [LAST_RESORT]; lastResort = true; }
    pool.forEach((id) => tried.add(id));

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(perTryMs, left));
    let served = pool[0];
    try {
      const r = await fetch(CHAT_URL, {
        method: "POST", signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://residual-continuum.vercel.app",
          "X-Title": title || "Residual Continuum",
        },
        body: JSON.stringify({
          models: pool, messages, temperature, max_tokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          reasoning: { effort: "low", exclude: true },
          provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, allow_fallbacks: true },
        }),
      });
      if (!r.ok) {
        lastErr = `model ${r.status}`;
        if (r.status === 401 || r.status === 402) throw Object.assign(new Error(lastErr), { fatal: true });
        pool.forEach((id) => bench(id, r.status === 429 ? 5 * 60_000 : BENCH_MS));
        continue;
      }
      const out = await r.json();
      served = out.model || served;
      /* the other models in this batch were never reached: keep them in play */
      pool.filter((id) => id !== served).forEach((id) => tried.delete(id));
      tried.add(served);
      if (out.error) { lastErr = `model error ${out.error.code || ""}`; bench(served); continue; }
      const text = (out.choices?.[0]?.message?.content || "").trim();
      if (!text) { lastErr = "empty reply"; bench(served, 5 * 60_000); continue; }
      const value = parse(text);
      return { value, model: served };
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 120);
      bench(served, e.name === "AbortError" ? 5 * 60_000 : BENCH_MS);
    } finally { clearTimeout(timer); }
  }
  throw new Error(lastErr);
}

/** Pull the first JSON object out of a model reply (fences, preambles and all). */
export function extractJSON(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in reply");
  return JSON.parse(t.slice(a, b + 1));
}
