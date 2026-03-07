/**
 * Purpose:
 * Renders a validated slide plan JSON into a Freeport-themed PowerPoint deck.
 *
 * Role in Pipeline:
 * Maps each logical layout type (summary, metrics, chart, two-column, actions)
 * to concrete slide shapes/text/charts using shared styleguide primitives.
 *
 * Impact on Overall Solution:
 * This is the visual realization layer that translates narrative structure into
 * consistent, branded slides that can be distributed or further reviewed.
 */
const path = require('node:path');
const {
  FREEPORT_THEME,
  textStyle,
  shapeStyle,
  chartStyle,
  createFreeportPresentation,
  addTitleSlide,
  addContentSlide,
} = require('../behavior/freeport-slide-styleguide');
const { buildImageSelector } = require('./image-matcher');

const CONTENT_SHIFT_X = -0.2335;

function sx(x) {
  return Number((x + CONTENT_SHIFT_X).toFixed(4));
}

function joinedBullets(items = []) {
  const clean = items.filter(Boolean).slice(0, 8);
  return clean.map((x) => `• ${x}`).join('\n');
}

function bulletRuns(items = []) {
  const clean = items.filter(Boolean).slice(0, 8);
  return clean.map((text, idx) => ({
    text: String(text),
    options: {
      bullet: { indent: FREEPORT_THEME.listStyles.bullet.indentPt },
      paraSpaceAfterPt: FREEPORT_THEME.listStyles.bullet.paraSpaceAfterPt,
      breakLine: idx < clean.length - 1,
    },
  }));
}

function splitBullets(items = []) {
  const clean = items.filter(Boolean).slice(0, 8);
  const midpoint = Math.ceil(clean.length / 2);
  return {
    left: clean.slice(0, midpoint),
    right: clean.slice(midpoint),
  };
}

function listOrEmpty(items) {
  return Array.isArray(items) ? items : [];
}

function addCardImage(slide, pres, image, {
  x, y, w, h, frameStyle = 'cardAlt', drawFrame = true, pad = 0.08,
}) {
  const imagePath = image?.file;
  const srcW = Number(image?.widthPx || 0);
  const srcH = Number(image?.heightPx || 0);
  if (!imagePath || !srcW || !srcH) return;

  if (drawFrame) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w, h,
      ...shapeStyle(frameStyle),
    });
  }

  const boxX = x + pad;
  const boxY = y + pad;
  const boxW = w - (pad * 2);
  const boxH = h - (pad * 2);

  const srcRatio = srcW / srcH;
  const boxRatio = boxW / boxH;
  let drawW = boxW;
  let drawH = boxH;
  if (srcRatio > boxRatio) {
    drawH = boxW / srcRatio;
  } else {
    drawW = boxH * srcRatio;
  }

  const drawX = boxX + ((boxW - drawW) / 2);
  const drawY = boxY + ((boxH - drawH) / 2);
  slide.addImage({ path: imagePath, x: drawX, y: drawY, w: drawW, h: drawH });
}

function hashText(value = '') {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h) + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function chooseVariant(layout, model, slideIndex, previousVariantKey) {
  const catalog = {
    summary_card: ['summary_card', 'summary_band'],
    two_column: ['two_column', 'two_column_stagger'],
    metrics: ['metrics', 'metrics_strip'],
    chart_bar: ['chart_bar', 'chart_bar_focus'],
    action_split: ['action_split', 'action_checklist'],
    default: ['summary_card', 'summary_band'],
  };

  const candidates = catalog[layout] || catalog.default;
  const seed = hashText(`${layout}|${model.title || ''}|${slideIndex}`);
  let selected = candidates[seed % candidates.length];
  if (candidates.length > 1 && selected === previousVariantKey) {
    selected = candidates[(seed + 1) % candidates.length];
  }
  return selected;
}

function addSummaryCard(slide, pres, model) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 1.95, w: 12.0, h: 4.85,
    ...shapeStyle('card'),
  });

  if (model.summary) {
    slide.addText(model.summary, {
      x: sx(1.2), y: 2.3, w: 11.4, h: 1.3,
      ...textStyle('bodyLarge'),
    });
  }

  slide.addText(bulletRuns(model.bullets), {
    x: sx(1.2), y: model.summary ? 3.75 : 2.3, w: 11.4, h: model.summary ? 2.9 : 4.3,
    ...textStyle('body'),
  });
}

function addSummaryBand(slide, pres, model) {
  const { left, right } = splitBullets(model.bullets);

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 1.95, w: 12.0, h: 1.35,
    ...shapeStyle('cardAlt'),
  });
  slide.addText(model.summary || (model.bullets[0] || ''), {
    x: sx(1.2), y: 2.28, w: 11.4, h: 0.75,
    ...textStyle('bodyLarge', { color: FREEPORT_THEME.colors.brandBlue }),
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 3.55, w: 5.9, h: 3.25,
    ...shapeStyle('card'),
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(7.0), y: 3.55, w: 5.9, h: 3.25,
    ...shapeStyle('card'),
  });

  slide.addText('Key Points', {
    x: sx(1.2), y: 3.9, w: 5.2, h: 0.45,
    ...textStyle('cardHeading'),
  });
  slide.addText(bulletRuns(left), {
    x: sx(1.2), y: 4.45, w: 5.2, h: 2.15,
    ...textStyle('body'),
  });

  slide.addText('Implications', {
    x: sx(7.3), y: 3.9, w: 5.2, h: 0.45,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(right.length ? right : left), {
    x: sx(7.3), y: 4.45, w: 5.2, h: 2.15,
    ...textStyle('body'),
  });
}

function addTwoColumn(slide, pres, model, rightAlt = false, ctx = {}) {
  const leftBullets = listOrEmpty(model.leftBullets);
  const rightBullets = listOrEmpty(model.rightBullets);
  const image = ctx.slideImage;

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 1.95, w: 5.9, h: 4.85,
    ...shapeStyle('card'),
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(7.0), y: 1.95, w: 5.9, h: 4.85,
    ...(rightAlt ? shapeStyle('cardAlt') : shapeStyle('card')),
  });

  slide.addText(model.leftTitle || 'Left', {
    x: sx(1.2), y: 2.3, w: 5.2, h: 0.5,
    ...textStyle('cardHeading'),
  });
  slide.addText(bulletRuns(leftBullets.length ? leftBullets : listOrEmpty(model.bullets)), {
    x: sx(1.2), y: 2.95, w: 5.2, h: 3.6,
    ...textStyle('body'),
  });

  slide.addText(model.rightTitle || 'Right', {
    x: sx(7.3), y: 2.3, w: 5.2, h: 0.5,
    ...textStyle('cardHeading', { color: rightAlt ? FREEPORT_THEME.colors.brandBlue : FREEPORT_THEME.colors.ink }),
  });
  slide.addText(bulletRuns(rightBullets), {
    x: sx(7.3), y: 2.95, w: 5.2, h: image ? 1.5 : 3.6,
    ...textStyle('body'),
  });
  if (image?.file) {
    addCardImage(slide, pres, image, {
      x: sx(7.22), y: 4.42, w: 5.45, h: 2.28,
    });
  }
}

function addTwoColumnStagger(slide, pres, model, rightAlt = false, ctx = {}) {
  const leftList = listOrEmpty(model.leftBullets);
  const rightList = listOrEmpty(model.rightBullets);
  const bullets = listOrEmpty(model.bullets);
  const leftBullets = leftList.length ? leftList : bullets;
  const rightBullets = rightList.length ? rightList : bullets.slice(0, 4);
  const image = ctx.slideImage;

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 1.95, w: 5.9, h: 4.85,
    ...shapeStyle('cardAlt'),
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(7.0), y: 1.95, w: 5.9, h: 4.85,
    ...(rightAlt ? shapeStyle('cardAlt') : shapeStyle('card')),
  });

  slide.addText(model.leftTitle || 'Context', {
    x: sx(1.2), y: 2.3, w: 5.2, h: 0.45,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(leftBullets), {
    x: sx(1.2), y: 2.95, w: 5.2, h: 3.6,
    ...textStyle('body'),
  });

  slide.addText(model.rightTitle || 'Decision', {
    x: sx(7.3), y: 2.3, w: 5.2, h: 0.45,
    ...textStyle('cardHeading', { color: rightAlt ? FREEPORT_THEME.colors.brandBlue : FREEPORT_THEME.colors.ink }),
  });
  slide.addText(bulletRuns(rightBullets), {
    x: sx(7.3), y: 2.95, w: 5.2, h: image ? 1.5 : 3.6,
    ...textStyle('body'),
  });
  if (image?.file) {
    addCardImage(slide, pres, image, {
      x: sx(7.22), y: 4.42, w: 5.45, h: 2.28,
    });
  }
}

function addTwoColumnImage(slide, pres, model, ctx = {}) {
  const image = ctx.slideImage;
  const leftList = listOrEmpty(model.leftBullets);
  const rightList = listOrEmpty(model.rightBullets);
  const bullets = listOrEmpty(model.bullets);
  const topBullets = leftList.length ? leftList : bullets.slice(0, 5);
  const bottomBullets = rightList.length ? rightList : bullets.slice(5, 10);

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.51), y: 1.95, w: 6.1, h: 4.85,
    ...shapeStyle('card'),
  });
  if (image?.file) {
    addCardImage(slide, pres, image, {
      x: sx(0.64), y: 2.18, w: 5.88, h: 4.4, drawFrame: false,
    });
  }

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(6.96), y: 1.95, w: 6.33, h: 2.25,
    ...shapeStyle('cardAlt'),
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(6.96), y: 4.55, w: 6.33, h: 2.25,
    ...shapeStyle('card'),
  });

  slide.addText(model.leftTitle || 'Context', {
    x: sx(7.16), y: 2.23, w: 5.93, h: 0.38,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(topBullets), {
    x: sx(7.16), y: 2.70, w: 5.93, h: 1.36,
    ...textStyle('body', { fit: 'shrink' }),
  });

  slide.addText(model.rightTitle || 'Implications', {
    x: sx(7.16), y: 4.83, w: 5.93, h: 0.38,
    ...textStyle('cardHeading'),
  });
  slide.addText(bulletRuns(bottomBullets.length ? bottomBullets : topBullets), {
    x: sx(7.16), y: 5.30, w: 5.93, h: 1.36,
    ...textStyle('body', { fit: 'shrink' }),
  });
}

function addMetrics(slide, pres, model) {
  const metrics = model.metrics.slice(0, 4);
  const slots = [
    { x: sx(0.9), y: 2.0 },
    { x: sx(7.0), y: 2.0 },
    { x: sx(0.9), y: 4.5 },
    { x: sx(7.0), y: 4.5 },
  ];

  metrics.forEach((m, i) => {
    const slot = slots[i];
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: slot.x, y: slot.y, w: 5.9, h: 2.1,
      ...shapeStyle('card'),
    });
    slide.addText(m.label || 'Metric', {
      x: slot.x + 0.3, y: slot.y + 0.2, w: 5.3, h: 0.4,
      ...textStyle('label'),
    });
    slide.addText(m.value || '-', {
      x: slot.x + 0.3, y: slot.y + 0.65, w: 5.3, h: 0.7,
      ...textStyle('contentTitle', { color: FREEPORT_THEME.colors.brandBlue, fontSize: 26 }),
    });
    slide.addText(m.note || '', {
      x: slot.x + 0.3, y: slot.y + 1.45, w: 5.3, h: 0.45,
      ...textStyle('body'),
    });
  });

  if (model.bullets.length) {
    slide.addText(joinedBullets(model.bullets.slice(0, 2)), {
      x: sx(0.9), y: 6.8, w: 12.0, h: 0.5,
      ...textStyle('note'),
    });
  }
}

function addMetricsStrip(slide, pres, model) {
  const metrics = model.metrics.slice(0, 4);
  const stripX = sx(0.9);
  const stripW = 12.0;
  const gap = 0.25;
  const cardW = (stripW - (gap * 3)) / 4;
  const synthesizedBullets = metrics
    .map((m) => [m.label, m.value, m.note].filter(Boolean).join(': '))
    .filter(Boolean);
  const readouts = listOrEmpty(model.bullets).length ? model.bullets : synthesizedBullets;

  metrics.forEach((m, i) => {
    const x = stripX + (i * (cardW + gap));
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: 2.15, w: cardW, h: 2.55,
      ...shapeStyle(i % 2 === 0 ? 'card' : 'cardAlt'),
    });
    slide.addText(m.label || 'Metric', {
      x: x + 0.2, y: 2.42, w: cardW - 0.4, h: 0.35,
      ...textStyle('label'),
    });
    slide.addText(m.value || '-', {
      x: x + 0.2, y: 2.8, w: cardW - 0.4, h: 0.72,
      ...textStyle('contentTitle', { color: FREEPORT_THEME.colors.brandBlue, fontSize: 24 }),
    });
    slide.addText(m.note || '', {
      x: x + 0.2, y: 3.6, w: cardW - 0.4, h: 0.8,
      ...textStyle('body', { fontSize: 12 }),
    });
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 4.95, w: 12.0, h: 1.85,
    ...shapeStyle('card'),
  });
  slide.addText('What This Means', {
    x: sx(1.2), y: 5.25, w: 11.4, h: 0.4,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(readouts.slice(0, 3)), {
    x: sx(1.2), y: 5.75, w: 11.4, h: 0.9,
    ...textStyle('body'),
  });
}

function normalizeChartPayload(model) {
  const chart = model.chart || { title: '', categories: [], series: [] };
  const categories = chart.categories.length ? chart.categories : ['A', 'B'];
  const series = (chart.series || []).slice(0, 3).map((s) => ({
    name: s.name || 'Series',
    labels: categories,
    values: (s.values || []).slice(0, categories.length).map((v) => Number(v) || 0),
  }));
  if (!series.length) {
    series.push({ name: 'Series 1', labels: categories, values: categories.map(() => 0) });
  }
  return { chart, categories, series };
}

function shouldSplitKpiCharts(categories, series) {
  if (!categories.length || categories.length < 2) return false;

  // If KPI units differ (e.g., kcal/ton vs $/ton vs inches), never force a shared axis.
  const unitTokens = categories
    .map((label) => {
      const m = String(label).match(/\(([^)]+)\)/);
      return m ? m[1].trim().toLowerCase() : '';
    })
    .filter(Boolean);
  if (new Set(unitTokens).size > 1) return true;

  const maxima = categories.map((_, idx) => {
    const vals = series.map((s) => Math.abs(Number(s.values[idx]) || 0));
    return Math.max(...vals, 0);
  });
  const nonZero = maxima.filter((v) => v > 0);
  if (nonZero.length < 2) return false;
  const maxVal = Math.max(...nonZero);
  const minVal = Math.min(...nonZero);
  return (maxVal / minVal) >= 8;
}

function addSplitKpiCharts(slide, pres, { chart, categories, series, bullets }) {
  const shown = categories.slice(0, 3);
  const gap = 0.25;
  const panelW = (12.0 - (gap * (shown.length - 1))) / shown.length;
  const baseX = sx(0.9);
  const plannedLabel = series[0]?.name || 'Planned / Optimal';
  const actualLabel = series[1]?.name || 'Actual';
  const plannedColor = FREEPORT_THEME.chartDefaults.chartColors[0] || FREEPORT_THEME.colors.brandBlue;
  const actualColor = FREEPORT_THEME.chartDefaults.chartColors[1] || '79D9FF';

  slide.addText(chart.title || 'KPI Comparison (Independent Scales)', {
    x: sx(0.9), y: 1.78, w: 8.2, h: 0.24,
    ...textStyle('label', { color: FREEPORT_THEME.colors.ink, bold: true, fontSize: 12 }),
  });

  slide.addShape(pres.shapes.RECTANGLE, {
    x: sx(9.25), y: 1.80, w: 0.12, h: 0.12,
    fill: { color: plannedColor },
    line: { color: plannedColor, pt: 0 },
  });
  slide.addText(plannedLabel, {
    x: sx(9.42), y: 1.78, w: 1.45, h: 0.22,
    ...textStyle('label', { fontSize: 10 }),
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: sx(10.95), y: 1.80, w: 0.12, h: 0.12,
    fill: { color: actualColor },
    line: { color: actualColor, pt: 0 },
  });
  slide.addText(actualLabel, {
    x: sx(11.12), y: 1.78, w: 1.05, h: 0.22,
    ...textStyle('label', { fontSize: 10 }),
  });

  shown.forEach((label, idx) => {
    const panelX = baseX + idx * (panelW + gap);
    const localSeries = series.map((s) => ({
      name: s.name,
      labels: [label],
      values: [Number(s.values[idx]) || 0],
    }));

    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: panelX, y: 2.18, w: panelW, h: 3.07,
      ...shapeStyle(idx % 2 === 0 ? 'card' : 'cardAlt'),
    });
    slide.addText(label, {
      x: panelX + 0.18, y: 2.34, w: panelW - 0.36, h: 0.3,
      ...textStyle('label', { color: FREEPORT_THEME.colors.ink, bold: true }),
    });
    slide.addChart(pres.charts.BAR, localSeries, {
      x: panelX + 0.12, y: 2.60, w: panelW - 0.24, h: 2.50,
      ...chartStyle({
        showLegend: false,
        showTitle: false,
        valAxisMinVal: 0,
        dataLabelPosition: 'outEnd',
      }),
    });
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 5.45, w: 12.0, h: 1.35,
    ...shapeStyle('cardAlt'),
  });
  slide.addText(bulletRuns(bullets), {
    x: sx(1.2), y: 5.62, w: 11.4, h: 1.12,
    ...textStyle('note', { color: FREEPORT_THEME.colors.ink, fontSize: 9.5 }),
  });
}

function addChartBar(slide, pres, model) {
  const { chart, categories, series } = normalizeChartPayload(model);
  if (shouldSplitKpiCharts(categories, series)) {
    addSplitKpiCharts(slide, pres, { chart, categories, series, bullets: listOrEmpty(model.bullets) });
    return;
  }

  slide.addChart(pres.charts.BAR, series, {
    x: sx(0.9), y: 2.0, w: 7.7, h: 4.8,
    ...chartStyle({
      showLegend: true,
      legendPos: 'b',
      showTitle: true,
      title: chart.title || 'Comparison',
      titleFontSize: 12,
      titleColor: FREEPORT_THEME.colors.ink,
      valAxisMinVal: 0,
    }),
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(8.8), y: 2.0, w: 4.1, h: 4.8,
    ...shapeStyle('cardAlt'),
  });
  slide.addText('Readouts', {
    x: sx(9.1), y: 2.35, w: 3.5, h: 0.45,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(model.bullets), {
    x: sx(9.1), y: 2.95, w: 3.5, h: 3.8,
    ...textStyle('body'),
  });
}

function addChartBarFocus(slide, pres, model) {
  const { chart, categories, series } = normalizeChartPayload(model);
  if (shouldSplitKpiCharts(categories, series)) {
    addSplitKpiCharts(slide, pres, { chart, categories, series, bullets: listOrEmpty(model.bullets) });
    return;
  }

  slide.addChart(pres.charts.BAR, series, {
    x: sx(0.9), y: 2.0, w: 12.0, h: 3.25,
    ...chartStyle({
      showLegend: true,
      legendPos: 'b',
      showTitle: true,
      title: chart.title || 'Comparison',
      titleFontSize: 12,
      titleColor: FREEPORT_THEME.colors.ink,
      valAxisMinVal: 0,
    }),
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 5.45, w: 12.0, h: 1.35,
    ...shapeStyle('cardAlt'),
  });
  slide.addText(bulletRuns(model.bullets), {
    x: sx(1.2), y: 5.66, w: 11.4, h: 1.06,
    ...textStyle('note', { color: FREEPORT_THEME.colors.ink, fontSize: 9.5 }),
  });
}

function addChartBarImage(slide, pres, model, ctx = {}) {
  const image = ctx.slideImage;
  const { chart, categories, series } = normalizeChartPayload(model);
  const shownCats = categories.slice(0, 3);
  const compactSeries = series.map((s) => ({
    name: s.name,
    labels: shownCats,
    values: (s.values || []).slice(0, shownCats.length),
  }));
  const plannedColor = FREEPORT_THEME.chartDefaults.chartColors[0] || FREEPORT_THEME.colors.brandBlue;
  const actualColor = FREEPORT_THEME.chartDefaults.chartColors[1] || '79D9FF';

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.42), y: 1.95, w: 6.95, h: 4.85,
    ...shapeStyle('card'),
  });
  if (image?.file) {
    addCardImage(slide, pres, image, {
      x: sx(0.48), y: 2.01, w: 6.83, h: 4.73, drawFrame: false, pad: 0.03,
    });
  }

  const chartCardX = sx(7.55);
  const chartCardY = 1.95;
  const chartCardW = 5.35;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: chartCardX, y: chartCardY, w: chartCardW, h: 2.75,
    ...shapeStyle('cardAlt'),
  });
  slide.addText(chart.title || 'Planned vs. Actual Blast Performance', {
    x: sx(7.78), y: 2.15, w: 4.95, h: 0.35,
    ...textStyle('label', { bold: true, color: FREEPORT_THEME.colors.brandBlue }),
  });

  const panelGap = 0.12;
  const panelX = sx(7.78);
  const panelY = 2.55;
  const panelH = 1.72;
  const panelW = (4.95 - (panelGap * (shownCats.length - 1))) / shownCats.length;
  shownCats.forEach((label, idx) => {
    const localSeries = compactSeries.map((s) => ({
      name: s.name,
      labels: [label],
      values: [Number(s.values[idx]) || 0],
    }));
    slide.addChart(pres.charts.BAR, localSeries, {
      x: panelX + (idx * (panelW + panelGap)), y: panelY, w: panelW, h: panelH,
      ...chartStyle({
        showLegend: false,
        showTitle: false,
        valAxisMinVal: 0,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 9,
      }),
    });
  });

  const legendY = 4.33;
  const swatchW = 0.11;
  const plannedLabelW = 1.05;
  const actualLabelW = 0.9;
  const itemGap = 0.34;
  const interGap = 0.42;
  const legendGroupW = swatchW + itemGap + plannedLabelW + interGap + swatchW + itemGap + actualLabelW;
  const legendStartX = chartCardX + ((chartCardW - legendGroupW) / 2);
  const plannedSwatchX = legendStartX;
  const plannedTextX = plannedSwatchX + itemGap;
  const actualSwatchX = plannedTextX + plannedLabelW + interGap;
  const actualTextX = actualSwatchX + itemGap;

  slide.addShape(pres.shapes.RECTANGLE, {
    x: plannedSwatchX, y: legendY, w: swatchW, h: swatchW,
    fill: { color: plannedColor }, line: { color: plannedColor, pt: 0 },
  });
  slide.addText('Planned', {
    x: plannedTextX, y: 4.29, w: plannedLabelW, h: 0.18,
    ...textStyle('label', { fontSize: 10 }),
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: actualSwatchX, y: legendY, w: swatchW, h: swatchW,
    fill: { color: actualColor }, line: { color: actualColor, pt: 0 },
  });
  slide.addText('Actual', {
    x: actualTextX, y: 4.29, w: actualLabelW, h: 0.18,
    ...textStyle('label', { fontSize: 10 }),
  });

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(7.55), y: 4.9, w: 5.35, h: 1.9,
    ...shapeStyle('card'),
  });
  slide.addText('Key Takeaways', {
    x: sx(7.78), y: 5.08, w: 4.95, h: 0.3,
    ...textStyle('cardHeading'),
  });
  slide.addText(bulletRuns(listOrEmpty(model.bullets).slice(0, 4)), {
    x: sx(7.78), y: 5.54, w: 4.95, h: 1.08,
    ...textStyle('body', { fontSize: 12, fit: 'shrink' }),
  });
}

function addActionChecklist(slide, pres, model) {
  const rightList = listOrEmpty(model.rightBullets);
  const leftList = listOrEmpty(model.leftBullets);
  const bullets = listOrEmpty(model.bullets);
  const actions = rightList.length ? rightList : bullets;
  const reasons = leftList.length ? leftList : bullets;

  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(0.9), y: 1.95, w: 4.6, h: 4.85,
    ...shapeStyle('cardAlt'),
  });
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: sx(5.8), y: 1.95, w: 7.1, h: 4.85,
    ...shapeStyle('card'),
  });

  slide.addText(model.leftTitle || 'Why Now', {
    x: sx(1.2), y: 2.3, w: 4.0, h: 0.45,
    ...textStyle('cardHeading', { color: FREEPORT_THEME.colors.brandBlue }),
  });
  slide.addText(bulletRuns(reasons.slice(0, 4)), {
    x: sx(1.2), y: 2.85, w: 4.0, h: 3.7,
    ...textStyle('body'),
  });

  slide.addText(model.rightTitle || 'Action Plan', {
    x: sx(6.1), y: 2.3, w: 6.5, h: 0.45,
    ...textStyle('cardHeading', { fontSize: 18 }),
  });
  slide.addText(actions.slice(0, 5).map((text, idx) => `${idx + 1}. ${text}`).join('\n'), {
    x: sx(6.1), y: 2.85, w: 6.5, h: 3.75,
    ...textStyle('body'),
  });
}

const LAYOUT_RENDERERS = {
  summary_card: addSummaryCard,
  summary_band: addSummaryBand,
  two_column: (slide, pres, model, ctx) => addTwoColumn(slide, pres, model, false, ctx),
  two_column_stagger: (slide, pres, model, ctx) => addTwoColumnStagger(slide, pres, model, false, ctx),
  two_column_image: addTwoColumnImage,
  action_split: (slide, pres, model, ctx) => addTwoColumn(slide, pres, model, true, ctx),
  action_checklist: addActionChecklist,
  metrics: addMetrics,
  metrics_strip: addMetricsStrip,
  chart_bar: addChartBar,
  chart_bar_focus: addChartBarFocus,
  chart_bar_image: addChartBarImage,
};

async function renderPlanToFreeportDeck({ plan, outputPath, imageAssets = null }) {
  const pres = createFreeportPresentation();
  const selectImageForSlide = buildImageSelector(imageAssets);
  const IMAGE_CAPABLE_LAYOUTS = new Set(['two_column', 'chart_bar']);

  addTitleSlide(pres, {
    title: plan.deckTitle || 'Narrative Deck',
    subtitle: plan.deckSubtitle || '',
  });

  let previousVariantKey = null;
  for (let i = 0; i < plan.slides.length; i += 1) {
    const slideModel = plan.slides[i];
    const slide = addContentSlide(pres, { title: slideModel.title || 'Untitled' });
    const slideImage = IMAGE_CAPABLE_LAYOUTS.has(slideModel.layout)
      ? selectImageForSlide(slideModel)
      : null;
    let variantKey = chooseVariant(slideModel.layout, slideModel, i, previousVariantKey);
    if (slideModel.layout === 'two_column' && slideImage?.file) variantKey = 'two_column_image';
    if (slideModel.layout === 'chart_bar' && slideImage?.file) variantKey = 'chart_bar_image';
    const renderer = LAYOUT_RENDERERS[variantKey] || LAYOUT_RENDERERS.summary_card;
    renderer(slide, pres, slideModel, { slideImage });
    previousVariantKey = variantKey;
  }

  await pres.writeFile({ fileName: outputPath });
  return path.resolve(outputPath);
}

module.exports = {
  renderPlanToFreeportDeck,
};
