/**
 * Purpose:
 * Converts extracted narrative text into a structured slide plan JSON using
 * the storytelling skill plus strict normalization and validation rules.
 *
 * Role in Pipeline:
 * Owns LLM request/response handling, schema normalization, title constraints,
 * pyramid-layout checks, numeric consistency checks, and retry-on-validation-fail.
 *
 * Impact on Overall Solution:
 * This file is the quality gate before rendering; it prevents weak or malformed
 * plans from reaching deck generation and preserves narrative/format integrity.
 */
const fs = require('node:fs/promises');

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';
const DEFAULT_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const MAX_TITLE_WORDS = 14;
const MAX_TITLE_CHARS = 85;
const ALLOWED_LAYOUTS = new Set(['summary_card', 'two_column', 'metrics', 'chart_bar', 'action_split']);
const ALLOWED_ROLES = new Set(['executive_summary', 'supporting_logic', 'evidence', 'implication']);
const ROLE_LAYOUT_MAP = {
  executive_summary: new Set(['summary_card']),
  supporting_logic: new Set(['metrics', 'two_column']),
  evidence: new Set(['chart_bar', 'two_column']),
  implication: new Set(['action_split']),
};

function ensureApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }
  return key;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('LLM response was not valid JSON.');
    return JSON.parse(raw.slice(first, last + 1));
  }
}

async function requestAnthropicJson({ apiKey, systemPrompt, userPrompt }) {
  const response = await fetch(`${DEFAULT_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 3500,
      temperature: 0.2,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const json = await response.json();
  const raw = Array.isArray(json?.content)
    ? json.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim()
    : '';
  if (!raw) {
    throw new Error('No content returned from LLM.');
  }
  return raw;
}

function normalizePlan(plan, maxSlides) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Planner returned empty plan.');
  }

  const normalized = {
    deckTitle: String(plan.deckTitle || 'Generated Narrative Deck'),
    deckSubtitle: String(plan.deckSubtitle || 'LLM-generated outline'),
    mainAnswer: String(plan.mainAnswer || ''),
    supportingArguments: Array.isArray(plan.supportingArguments)
      ? plan.supportingArguments.slice(0, 4).map((a, idx) => ({
          id: String(a.id || `A${idx + 1}`),
          claim: String(a.claim || ''),
        }))
      : [],
    slides: Array.isArray(plan.slides) ? plan.slides.slice(0, maxSlides) : [],
  };

  if (normalized.slides.length === 0) {
    throw new Error('Planner returned no slides.');
  }

  function trimToWordBoundary(text, maxChars) {
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    return cut.replace(/\s+\S*$/, '').trim();
  }

  function dropDanglingEnding(text) {
    return text
      .replace(/\b(a|an|the|and|or|of|to|for|with|in|on|by|at|from|into|over|under)\s*$/i, '')
      .trim();
  }

  function normalizeSlideTitle(rawTitle, fallback) {
    let title = String(rawTitle || fallback || '').replace(/\s+/g, ' ').trim();
    if (!title) return fallback;

    // Hard cap by word count for two-line fit at 28pt.
    const words = title.split(' ');
    if (words.length > MAX_TITLE_WORDS) {
      title = words.slice(0, MAX_TITLE_WORDS).join(' ');
    }

    // Hard cap by character count.
    title = trimToWordBoundary(title, MAX_TITLE_CHARS);
    title = dropDanglingEnding(title);

    title = title.replace(/[,;:\-–—]\s*$/, '').trim();
    if (!/[.!?]$/.test(title)) title += '.';
    if (title.length > MAX_TITLE_CHARS || /\b(a|an|the)\.$/i.test(title)) {
      title = trimToWordBoundary(title.replace(/[.!?]$/, ''), MAX_TITLE_CHARS).trim();
      title = dropDanglingEnding(title);
      if (!/[.!?]$/.test(title)) title += '.';
    }
    return title;
  }

  normalized.slides = normalized.slides.map((s, i) => ({
    layout: String(s.layout || 'summary_card'),
    pyramidRole: String(s.pyramidRole || ''),
    supportsArgument: String(s.supportsArgument || ''),
    title: normalizeSlideTitle(s.title, `Slide ${i + 1}`),
    summary: s.summary ? String(s.summary) : '',
    sourceRefs: Array.isArray(s.sourceRefs) ? s.sourceRefs.map(String).slice(0, 3) : [],
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : [],
    leftTitle: s.leftTitle ? String(s.leftTitle) : '',
    leftBullets: Array.isArray(s.leftBullets) ? s.leftBullets.map(String) : [],
    rightTitle: s.rightTitle ? String(s.rightTitle) : '',
    rightBullets: Array.isArray(s.rightBullets) ? s.rightBullets.map(String) : [],
    metrics: Array.isArray(s.metrics)
      ? s.metrics.map((m) => ({
          label: String(m.label || ''),
          value: String(m.value || ''),
          note: String(m.note || ''),
        }))
      : [],
    chart: s.chart && typeof s.chart === 'object'
      ? {
          title: String(s.chart.title || ''),
          categories: Array.isArray(s.chart.categories) ? s.chart.categories.map(String) : [],
          series: Array.isArray(s.chart.series)
            ? s.chart.series.map((x) => ({
                name: String(x.name || ''),
                values: Array.isArray(x.values) ? x.values.map((n) => Number(n) || 0) : [],
              }))
            : [],
        }
      : null,
  }));

  return normalized;
}

function validatePlan(plan) {
  const issues = [];
  const slides = plan.slides || [];
  const metricValueByLabel = new Map();

  if (!plan.mainAnswer || !plan.mainAnswer.trim()) {
    issues.push('`mainAnswer` is required.');
  }

  if (!Array.isArray(plan.supportingArguments) || plan.supportingArguments.length < 2 || plan.supportingArguments.length > 4) {
    issues.push('`supportingArguments` must contain 2-4 items.');
  } else {
    for (const arg of plan.supportingArguments) {
      if (!/^A[1-4]$/.test(arg.id || '')) issues.push(`Invalid supporting argument id: ${arg.id}`);
      if (!arg.claim || !arg.claim.trim()) issues.push(`Supporting argument ${arg.id || '(missing id)'} is missing a claim.`);
    }
  }

  if (!slides.length) issues.push('At least one slide is required.');
  if (slides.length && slides[0].pyramidRole !== 'executive_summary') {
    issues.push('First slide must have `pyramidRole=executive_summary`.');
  }
  if (slides.length && slides[slides.length - 1].pyramidRole !== 'implication') {
    issues.push('Final slide must have `pyramidRole=implication`.');
  }
  if (!slides.some((s) => s.pyramidRole === 'evidence')) {
    issues.push('At least one slide must have `pyramidRole=evidence`.');
  }

  const contentSlides = slides.slice(1);
  const contentCount = contentSlides.length || 1;
  const byLayout = contentSlides.reduce((acc, s) => {
    acc[s.layout] = (acc[s.layout] || 0) + 1;
    return acc;
  }, {});

  const distinctLayouts = Object.keys(byLayout).length;
  if (distinctLayouts < 3) {
    issues.push('Layout diversity failed: use at least 3 distinct layouts across content slides.');
  }

  const twoColumnCount = byLayout.two_column || 0;
  if (twoColumnCount > Math.floor(contentCount / 2)) {
    issues.push('Layout diversity failed: `two_column` exceeds 50% of content slides.');
  }

  const hasNumericKpis = slides.some((s) =>
    (Array.isArray(s.metrics) && s.metrics.some((m) => /[0-9]/.test(`${m.value || ''}${m.note || ''}`))) ||
    (s.chart && Array.isArray(s.chart.series) && s.chart.series.some((sr) => Array.isArray(sr.values) && sr.values.some((v) => Number(v) !== 0)))
  );
  if (hasNumericKpis && !(byLayout.metrics > 0)) {
    issues.push('Layout diversity failed: numeric KPI content detected but no `metrics` slide present.');
  }

  const hasPlannedActual = slides.some((s) => {
    const txt = `${s.title || ''} ${s.summary || ''} ${(s.bullets || []).join(' ')}`.toLowerCase();
    return txt.includes('planned') && txt.includes('actual');
  });
  if (hasPlannedActual && !(byLayout.chart_bar > 0)) {
    issues.push('Layout diversity failed: planned vs actual content detected but no `chart_bar` slide present.');
  }

  slides.forEach((s, idx) => {
    const n = idx + 1;
    if (!ALLOWED_LAYOUTS.has(s.layout)) {
      issues.push(`Slide ${n}: invalid layout "${s.layout}".`);
    }
    if (!ALLOWED_ROLES.has(s.pyramidRole)) {
      issues.push(`Slide ${n}: invalid pyramidRole "${s.pyramidRole}".`);
    }
    if (ROLE_LAYOUT_MAP[s.pyramidRole] && !ROLE_LAYOUT_MAP[s.pyramidRole].has(s.layout)) {
      issues.push(`Slide ${n}: layout "${s.layout}" not allowed for role "${s.pyramidRole}".`);
    }
    if (idx > 0 && (!s.supportsArgument || !s.supportsArgument.trim())) {
      issues.push(`Slide ${n}: non-summary slide is missing supportsArgument.`);
    }
    if (s.supportsArgument && s.supportsArgument !== 'ALL' && !/^A[1-4]$/.test(s.supportsArgument)) {
      issues.push(`Slide ${n}: invalid supportsArgument "${s.supportsArgument}".`);
    }
    if (!s.title || !s.title.trim()) {
      issues.push(`Slide ${n}: title is required.`);
    } else {
      const words = s.title.trim().split(/\s+/).length;
      const chars = s.title.length;
      if (words > MAX_TITLE_WORDS) issues.push(`Slide ${n}: title exceeds ${MAX_TITLE_WORDS} words.`);
      if (chars > MAX_TITLE_CHARS) issues.push(`Slide ${n}: title exceeds ${MAX_TITLE_CHARS} characters.`);
      if (!/[.!?]$/.test(s.title.trim())) issues.push(`Slide ${n}: title must end with sentence punctuation.`);
    }
    if (!Array.isArray(s.sourceRefs) || s.sourceRefs.length < 1 || s.sourceRefs.length > 3) {
      issues.push(`Slide ${n}: sourceRefs must contain 1-3 entries.`);
    } else {
      for (const ref of s.sourceRefs) {
        if (!/^PAGE\s+\d+:\s+.+$/i.test(ref.trim())) {
          issues.push(`Slide ${n}: invalid sourceRef format "${ref}".`);
        }
      }
    }
    if (s.layout === 'chart_bar') {
      const c = s.chart || {};
      const categoryCount = Array.isArray(c.categories) ? c.categories.length : 0;
      const seriesCount = Array.isArray(c.series) ? c.series.length : 0;
      if (categoryCount < 2 || seriesCount < 2) {
        issues.push(`Slide ${n}: chart_bar requires >=2 categories and >=2 series.`);
      }
    }

    if (Array.isArray(s.metrics)) {
      for (const m of s.metrics) {
        const label = String(m.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!label) continue;
        const valueNorm = String(m.value || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (!valueNorm) continue;
        if (!metricValueByLabel.has(label)) {
          metricValueByLabel.set(label, new Set([valueNorm]));
        } else {
          metricValueByLabel.get(label).add(valueNorm);
        }
      }
    }
  });

  for (const [label, values] of metricValueByLabel.entries()) {
    if (values.size > 1) {
      issues.push(`Numeric consistency failed: metric "${label}" has conflicting values: ${Array.from(values).join(' | ')}`);
    }
  }

  if (issues.length) {
    throw new Error(`Plan validation failed before render:\n- ${issues.join('\n- ')}`);
  }
}

async function planSlidesFromText({ inputText, inputName, skillPath, maxSlides = 7 }) {
  const apiKey = ensureApiKey();
  const skillText = await fs.readFile(skillPath, 'utf8');

  const truncatedText = inputText.slice(0, 22000);

  const systemPrompt = [
    'You are a senior presentation strategist for Freeport executive narrative decks.',
    'You must output JSON only, with no markdown fences or commentary.',
    'Follow the provided Freeport Slide Skill exactly.',
  ].join(' ');

  const userPrompt = [
    `Input name: ${inputName}`,
    '',
    'Freeport Slide Skill:',
    skillText,
    '',
    'Source text to transform into slides:',
    truncatedText,
    '',
    `Return between 5 and ${maxSlides} content slides in the schema.`
  ].join('\n');

  let lastValidationError = null;
  let lastCandidate = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptPrompt = attempt === 0
      ? userPrompt
      : [
          'Your previous JSON plan failed strict validation.',
          'Repair it and return corrected JSON only.',
          '',
          'Validation errors:',
          lastValidationError?.message || '(unknown)',
          '',
          'Previous normalized JSON:',
          JSON.stringify(lastCandidate, null, 2),
          '',
          'Keep the same factual grounding and source references.',
        ].join('\n');

    const raw = await requestAnthropicJson({
      apiKey,
      systemPrompt,
      userPrompt: attemptPrompt,
    });

    const plan = safeJsonParse(raw);
    const normalized = normalizePlan(plan, maxSlides);
    lastCandidate = normalized;

    try {
      validatePlan(normalized);
      return normalized;
    } catch (err) {
      lastValidationError = err;
      if (attempt === 1) {
        throw new Error(`Plan validation failed after retry.\n${err.message}`);
      }
    }
  }

  throw new Error('Unexpected planner retry flow failure.');
}

module.exports = {
  planSlidesFromText,
  normalizePlan,
  validatePlan,
};
