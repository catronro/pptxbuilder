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
  return requestAnthropicJsonWithOptions({ apiKey, systemPrompt, userPrompt });
}

async function requestAnthropicJsonWithOptions({
  apiKey,
  systemPrompt,
  userPrompt,
  temperature = 0.2,
  maxTokens = 3500,
}) {
  const response = await fetch(`${DEFAULT_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      temperature,
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
    title = title.replace(/\.\s*$/, '').trim();
    if (title.length > MAX_TITLE_CHARS || /\b(a|an|the)[.!?]?$/i.test(title)) {
      title = trimToWordBoundary(title.replace(/[.!?]$/, ''), MAX_TITLE_CHARS).trim();
      title = dropDanglingEnding(title);
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

function normalizeOutline(outline, maxSlides) {
  if (!outline || typeof outline !== 'object') {
    throw new Error('Outline planner returned empty outline.');
  }

  function normalizeRole(role) {
    const raw = String(role || '').trim().toLowerCase();
    if (raw === 'executive_summary' || raw === 'supporting_logic' || raw === 'evidence' || raw === 'implication') return raw;
    if (raw === 'main_answer' || raw === 'summary') return 'executive_summary';
    if (raw === 'supporting_argument' || raw === 'logic' || raw === 'supporting') return 'supporting_logic';
    if (raw === 'proof' || raw === 'data') return 'evidence';
    if (raw === 'recommendation' || raw === 'next_steps' || raw === 'synthesis') return 'implication';
    return raw;
  }

  function normalizeLayout(layout, role) {
    const raw = String(layout || '').trim().toLowerCase();
    if (ALLOWED_LAYOUTS.has(raw)) return raw;
    if (raw === 'executive_summary' || raw === 'summary') return 'summary_card';
    if (raw === 'text_and_chart' || raw === 'chart') {
      return normalizeRole(role) === 'supporting_logic' ? 'metrics' : 'chart_bar';
    }
    if (raw === 'single_chart') return 'chart_bar';
    if (raw === 'assertion_evidence_text') return 'two_column';
    if (raw === 'assertion_evidence_chart') {
      return normalizeRole(role) === 'supporting_logic' ? 'metrics' : 'chart_bar';
    }
    if (raw === 'text_and_image' || raw === 'image_and_text') return 'two_column';
    if (raw === 'actions' || raw === 'next_steps' || raw === 'implication') return 'action_split';
    if (raw === 'kpi' || raw === 'dashboard') return 'metrics';
    return raw;
  }

  const rawArgs = Array.isArray(outline.supportingArguments) ? outline.supportingArguments.slice(0, 4) : [];
  const normalizedArgs = rawArgs.map((a, idx) => {
    if (typeof a === 'string') {
      return { id: `A${idx + 1}`, claim: String(a || '').trim() };
    }
    return {
      id: String(a?.id || `A${idx + 1}`),
      claim: String(a?.claim || a?.statement || a?.text || '').trim(),
    };
  });

  const claimById = new Map(normalizedArgs.map((a) => [a.id, normalizeForDuplicateCheck(a.claim)]));
  function normalizeSupportRef(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^A[1-4]$/i.test(raw)) return raw.toUpperCase();
    if (/^all$/i.test(raw)) return 'ALL';
    if (/^[1-4]$/.test(raw)) return `A${raw}`;
    const key = normalizeForDuplicateCheck(raw);
    for (const [id, claim] of claimById.entries()) {
      if (!claim) continue;
      if (claim.includes(key) || key.includes(claim)) return id;
    }
    return raw;
  }

  function normalizeOutlineTitle(rawTitle, fallback) {
    let title = String(rawTitle || fallback || '').replace(/\s+/g, ' ').trim();
    if (!title) return fallback;
    const words = title.split(' ');
    if (words.length > MAX_TITLE_WORDS) {
      title = words.slice(0, MAX_TITLE_WORDS).join(' ');
    }
    if (title.length > MAX_TITLE_CHARS) {
      const cut = title.slice(0, MAX_TITLE_CHARS);
      title = cut.replace(/\s+\S*$/, '').trim();
    }
    return title.replace(/[,;:\-–—]\s*$/, '').replace(/\.\s*$/, '').trim();
  }

  return {
    deckTitle: String(outline.deckTitle || 'Generated Narrative Deck'),
    deckSubtitle: String(outline.deckSubtitle || 'LLM-generated outline'),
    mainAnswer: String(outline.mainAnswer || ''),
    supportingArguments: normalizedArgs,
    slides: Array.isArray(outline.slides)
      ? outline.slides.slice(0, maxSlides).map((s, i) => ({
          index: Number(s.index) || i + 1,
          title: normalizeOutlineTitle(s.title, `Slide ${i + 1}`),
          pyramidRole: normalizeRole(s.pyramidRole),
          supportsArgument: normalizeSupportRef(s.supportsArgument) || (i > 0 ? 'ALL' : ''),
          layout: normalizeLayout(s.layout, s.pyramidRole),
          intent: String(s.intent || ''),
        }))
      : [],
  };
}

function validateOutline(outline, maxSlides) {
  const issues = [];
  const slides = outline.slides || [];

  if (!outline.mainAnswer || !outline.mainAnswer.trim()) {
    issues.push('Outline requires non-empty mainAnswer.');
  }
  if (!Array.isArray(outline.supportingArguments) || outline.supportingArguments.length < 2 || outline.supportingArguments.length > 4) {
    issues.push('Outline supportingArguments must contain 2-4 items.');
  } else {
    for (const arg of outline.supportingArguments) {
      if (!/^A[1-4]$/.test(arg.id || '')) issues.push(`Outline has invalid argument id "${arg.id}".`);
      if (!arg.claim || !arg.claim.trim()) issues.push(`Outline argument ${arg.id || '(missing)'} has empty claim.`);
    }
  }

  if (slides.length < 5 || slides.length > maxSlides) {
    issues.push(`Outline slide count must be between 5 and ${maxSlides}, got ${slides.length}.`);
  }
  if (slides.length && slides[0].pyramidRole !== 'executive_summary') {
    issues.push('Outline first slide must be executive_summary.');
  }
  if (slides.length && slides[slides.length - 1].pyramidRole !== 'implication') {
    issues.push('Outline final slide must be implication.');
  }
  if (!slides.some((s) => s.pyramidRole === 'evidence')) {
    issues.push('Outline must include at least one evidence slide.');
  }

  slides.forEach((s, idx) => {
    const n = idx + 1;
    if (!ALLOWED_LAYOUTS.has(s.layout)) {
      issues.push(`Outline slide ${n}: invalid layout "${s.layout}".`);
    }
    if (!ALLOWED_ROLES.has(s.pyramidRole)) {
      issues.push(`Outline slide ${n}: invalid pyramidRole "${s.pyramidRole}".`);
    }
    if (ROLE_LAYOUT_MAP[s.pyramidRole] && !ROLE_LAYOUT_MAP[s.pyramidRole].has(s.layout)) {
      issues.push(`Outline slide ${n}: layout "${s.layout}" not allowed for role "${s.pyramidRole}".`);
    }
    if (idx > 0 && (!s.supportsArgument || !s.supportsArgument.trim())) {
      issues.push(`Outline slide ${n}: missing supportsArgument.`);
    }
    if (s.supportsArgument && s.supportsArgument !== 'ALL' && !/^A[1-4]$/.test(s.supportsArgument)) {
      issues.push(`Outline slide ${n}: invalid supportsArgument "${s.supportsArgument}".`);
    }
    if (!s.title || !s.title.trim()) {
      issues.push(`Outline slide ${n}: title is required.`);
    }
    const titleWords = String(s.title || '').trim().split(/\s+/).filter(Boolean).length;
    const titleChars = String(s.title || '').length;
    if (titleWords > MAX_TITLE_WORDS) {
      issues.push(`Outline slide ${n}: title exceeds ${MAX_TITLE_WORDS} words.`);
    }
    if (titleChars > MAX_TITLE_CHARS) {
      issues.push(`Outline slide ${n}: title exceeds ${MAX_TITLE_CHARS} chars.`);
    }
    if (!s.intent || !s.intent.trim()) {
      issues.push(`Outline slide ${n}: intent is required.`);
    }
  });

  if (issues.length) {
    throw new Error(`Outline validation failed:\n- ${issues.join('\n- ')}`);
  }
}

function normalizeForDuplicateCheck(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAssertionTitle(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (/^(overview|analysis|findings|next steps|executive summary)\b/i.test(t)) return false;
  const verbHint = /\b(is|are|was|were|will|can|must|shows|show|indicates|drive|drives|reduce|reduces|increase|increases|create|creates|caused|improved|improves|requires)\b/i;
  return verbHint.test(t) || /%|\$|[0-9]/.test(t);
}

function validatePlan(plan) {
  const issues = [];
  const slides = plan.slides || [];
  const metricValueByLabel = new Map();
  const argumentIds = new Set((plan.supportingArguments || []).map((a) => a.id));
  const argCoverage = new Map(Array.from(argumentIds).map((id) => [id, 0]));
  const roleOrder = {
    executive_summary: 0,
    supporting_logic: 1,
    evidence: 2,
    implication: 3,
  };
  let lastRoleRank = -1;
  const seenBullets = new Map();
  const seenTitles = new Set();

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
    const currentRoleRank = roleOrder[s.pyramidRole] ?? -1;
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
    if (idx > 0 && argCoverage.has(s.supportsArgument)) {
      argCoverage.set(s.supportsArgument, argCoverage.get(s.supportsArgument) + 1);
    }
    if (!s.title || !s.title.trim()) {
      issues.push(`Slide ${n}: title is required.`);
    } else {
      const dedupeTitle = normalizeForDuplicateCheck(s.title);
      if (seenTitles.has(dedupeTitle)) {
        issues.push(`Slide ${n}: title duplicates another slide title.`);
      }
      seenTitles.add(dedupeTitle);
      const words = s.title.trim().split(/\s+/).length;
      const chars = s.title.length;
      if (words > MAX_TITLE_WORDS) issues.push(`Slide ${n}: title exceeds ${MAX_TITLE_WORDS} words.`);
      if (chars > MAX_TITLE_CHARS) issues.push(`Slide ${n}: title exceeds ${MAX_TITLE_CHARS} characters.`);
      if (!isAssertionTitle(s.title)) issues.push(`Slide ${n}: title is not assertion-based enough.`);
    }
    if (currentRoleRank < lastRoleRank) {
      issues.push(`Slide ${n}: pyramidRole order regressed from previous slide.`);
    }
    if (currentRoleRank >= 0) {
      lastRoleRank = currentRoleRank;
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
      if (Array.isArray(c.categories)) {
        for (const cat of c.categories) {
          if (/(?:×|x)\s*100/i.test(String(cat || ''))) {
            issues.push(`Slide ${n}: chart category "${cat}" uses scaled units (x100), which is not allowed.`);
          }
        }
      }
    }

    const bulletBuckets = [
      ...(Array.isArray(s.bullets) ? s.bullets : []),
      ...(Array.isArray(s.leftBullets) ? s.leftBullets : []),
      ...(Array.isArray(s.rightBullets) ? s.rightBullets : []),
    ];
    bulletBuckets.forEach((b) => {
      const text = String(b || '').trim();
      if (!text) return;
      const wc = text.split(/\s+/).length;
      if (wc > 18) {
        issues.push(`Slide ${n}: bullet exceeds 18 words ("${text.slice(0, 60)}...").`);
      }
      const key = normalizeForDuplicateCheck(text);
      if (!key) return;
      const firstSeenSlide = seenBullets.get(key);
      if (firstSeenSlide && firstSeenSlide !== n) {
        issues.push(`Slide ${n}: repeated bullet from slide ${firstSeenSlide}.`);
      } else {
        seenBullets.set(key, n);
      }
    });

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
  for (const [argId, count] of argCoverage.entries()) {
    if (count === 0) {
      issues.push(`Narrative coverage failed: ${argId} is not supported by any non-summary slide.`);
    }
  }
  const usedArgs = Array.from(argCoverage.values()).filter((v) => v > 0).length;
  if ((plan.supportingArguments || []).length >= 3 && usedArgs < 2) {
    issues.push('Narrative coverage failed: supporting arguments are overly concentrated on a single argument.');
  }

  if (issues.length) {
    throw new Error(`Plan validation failed before render:\n- ${issues.join('\n- ')}`);
  }
}

function scorePlanQuality(plan) {
  const findings = [];
  let score = 100;
  const slides = plan.slides || [];
  const titles = slides.map((s) => String(s.title || '').trim()).filter(Boolean);
  const normTitles = new Set();
  for (const t of titles) {
    const key = normalizeForDuplicateCheck(t);
    if (normTitles.has(key)) {
      findings.push('Duplicate slide titles reduce narrative signal.');
      score -= 10;
    }
    normTitles.add(key);
    if (!isAssertionTitle(t)) {
      findings.push(`Weak assertion title: "${t}".`);
      score -= 8;
    }
  }

  const roleOrder = { executive_summary: 0, supporting_logic: 1, evidence: 2, implication: 3 };
  let prev = -1;
  for (const s of slides) {
    const curr = roleOrder[s.pyramidRole] ?? -1;
    if (curr < prev) {
      findings.push('Pyramid role order regresses across slides.');
      score -= 12;
      break;
    }
    if (curr >= 0) prev = curr;
  }

  const bulletSet = new Set();
  let repeatedBullets = 0;
  slides.forEach((s) => {
    const bullets = [
      ...(Array.isArray(s.bullets) ? s.bullets : []),
      ...(Array.isArray(s.leftBullets) ? s.leftBullets : []),
      ...(Array.isArray(s.rightBullets) ? s.rightBullets : []),
    ];
    bullets.forEach((b) => {
      const key = normalizeForDuplicateCheck(b);
      if (!key) return;
      if (bulletSet.has(key)) repeatedBullets += 1;
      bulletSet.add(key);
    });
  });
  if (repeatedBullets > 0) {
    findings.push(`Repeated bullet lines detected (${repeatedBullets}).`);
    score -= Math.min(20, repeatedBullets * 4);
  }

  const supportingIds = new Set((plan.supportingArguments || []).map((a) => a.id));
  const usedIds = new Set(
    slides
      .slice(1)
      .map((s) => s.supportsArgument)
      .filter((id) => supportingIds.has(id))
  );
  if (supportingIds.size >= 3 && usedIds.size < 2) {
    findings.push('Supporting argument usage is too concentrated.');
    score -= 12;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, findings };
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

  const outlinePrompt = [
    `Input name: ${inputName}`,
    '',
    'Freeport Slide Skill:',
    skillText,
    '',
    'Pass 1 task: Create only the narrative structure.',
    'Return JSON only with this schema:',
    '{',
    '  "deckTitle":"string",',
    '  "deckSubtitle":"string",',
    '  "mainAnswer":"string",',
    '  "supportingArguments":[{"id":"A1","claim":"string"}],',
    '  "slides":[{"index":1,"title":"string","pyramidRole":"executive_summary|supporting_logic|evidence|implication","supportsArgument":"A1|A2|A3|A4|ALL","layout":"summary_card|two_column|metrics|chart_bar|action_split","intent":"string"}]',
    '}',
    'Rules:',
    '- Keep 5 to maxSlides total slides.',
    '- Use only allowed enum values exactly as listed in schema.',
    '- Lock one idea per slide.',
    '- Enforce argument MECE and pyramid flow.',
    '- Do not include bullets/metrics/chart/sourceRefs in pass 1.',
    '',
    'Source text to transform into slides:',
    truncatedText,
    '',
    `maxSlides=${maxSlides}`
  ].join('\n');

  let outline = null;
  let lastOutlineError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const attemptPrompt = attempt === 0
      ? outlinePrompt
      : [
          'Your previous outline failed validation. Repair it.',
          '',
          'Validation errors:',
          lastOutlineError?.message || '(unknown)',
          '',
          'Return corrected outline JSON only.',
        ].join('\n');
    const raw = await requestAnthropicJsonWithOptions({
      apiKey,
      systemPrompt,
      userPrompt: attemptPrompt,
      temperature: 0.1,
      maxTokens: 2200,
    });
    const parsed = safeJsonParse(raw);
    const normalizedOutline = normalizeOutline(parsed, maxSlides);
    try {
      validateOutline(normalizedOutline, maxSlides);
      outline = normalizedOutline;
      break;
    } catch (err) {
      lastOutlineError = err;
    }
  }
  if (!outline) {
    throw new Error(`Outline generation failed.\n${lastOutlineError?.message || 'Unknown outline error.'}`);
  }

  const fullPlanPromptBase = [
    `Input name: ${inputName}`,
    '',
    'Freeport Slide Skill:',
    skillText,
    '',
    'Pass 2 task: Fill slide content using this LOCKED outline.',
    'Do not change slide count, order, role, supportsArgument, or layout.',
    'You may tighten wording for fit, but preserve each slide intent.',
    '',
    'LOCKED outline JSON:',
    JSON.stringify(outline, null, 2),
    '',
    'Return final full-schema JSON only.',
    '',
    'Source text to transform into slides:',
    truncatedText,
  ].join('\n');

  let lastValidationError = null;
  let bestCandidate = null;
  let bestScore = -1;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const attemptPrompt = attempt === 0
      ? fullPlanPromptBase
      : [
          fullPlanPromptBase,
          '',
          'Your previous plan failed quality checks.',
          'Repair and return corrected JSON only.',
          '',
          'Validation/quality feedback:',
          lastValidationError?.message || '(none)',
          '',
          bestCandidate ? `Previous best score: ${bestScore}` : 'No previous valid candidate.',
          bestCandidate ? JSON.stringify(bestCandidate, null, 2) : '',
        ].join('\n');

    const raw = await requestAnthropicJsonWithOptions({
      apiKey,
      systemPrompt,
      userPrompt: attemptPrompt,
      temperature: 0.15,
      maxTokens: 3800,
    });
    const parsed = safeJsonParse(raw);
    const normalized = normalizePlan(parsed, maxSlides);
    try {
      validatePlan(normalized);
      const quality = scorePlanQuality(normalized);
      if (quality.score > bestScore) {
        bestScore = quality.score;
        bestCandidate = normalized;
      }
      if (quality.score >= 82) {
        return normalized;
      }
      lastValidationError = new Error(`Quality score ${quality.score} below threshold 82.\n- ${quality.findings.join('\n- ')}`);
    } catch (err) {
      lastValidationError = err;
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  throw new Error(`Plan generation failed after retries.\n${lastValidationError?.message || 'Unknown planner failure.'}`);
}

module.exports = {
  planSlidesFromText,
  normalizePlan,
  validatePlan,
};
