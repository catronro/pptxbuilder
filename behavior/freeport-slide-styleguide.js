const path = require('node:path');
const pptxgen = require('pptxgenjs');

const FREEPORT_MASTERS = {
  TITLE: 'FREEPORT_TITLE',
  CONTENT: 'FREEPORT_CONTENT',
};

const FREEPORT_THEME = {
  fonts: {
    base: 'Arial',
    display: 'Arial Black',
  },
  colors: {
    white: 'FFFFFF',
    ink: '092033',
    muted: '64748B',
    bodySecondary: '334155',
    cardBorder: 'D1D5DB',
    cardBg: 'FFFFFF',
    cardAltBg: 'F8FAFC',
    slateBg: 'E2E8F0',
    slateBorder: '94A3B8',
    brandBlue: '007FB0',
    brandBlueDark: '00608A',
    brandOrange: 'F1792E',
    brandOrangeDark: 'B45309',
    brandGreen: '006C3C',
    brandGreenDark: '14532D',
  },
  layout: {
    titleBox: { x: 0.75, y: 2.63, w: 5.6, h: 1.0 },
    subtitleBox: { x: 0.75, y: 3.90, w: 5.6, h: 0.6 },
    contentTitleBox: { x: 0.253, y: 0.21, w: 8.95, h: 1.12 },
    contentBodyBox: { x: 0.258, y: 2.03, w: 12.732, h: 4.43 },
    slideNumberPatch: { x: 13.22, y: 7.35, w: 0.11, h: 0.13 },
  },
  textStyles: {
    titleSlideTitle: { fontFace: 'Arial', bold: true, fontSize: 36, color: 'FFFFFF', align: 'left', margin: 0 },
    titleSlideSubtitle: { fontFace: 'Arial', fontSize: 20, color: 'FFFFFF', align: 'left', margin: 0 },
    contentTitle: { fontFace: 'Arial', bold: true, fontSize: 28, color: 'FFFFFF', margin: 0 },
    contentBody: { fontFace: 'Arial', fontSize: 28, color: '092033', margin: 0.08 },
    cardHeading: { fontFace: 'Arial', fontSize: 20, bold: true, color: '092033', margin: 0 },
    body: { fontFace: 'Arial', fontSize: 15, color: '334155', valign: 'top', margin: 0 },
    centeredCallout: { fontFace: 'Arial Black', fontSize: 25, charSpacing: 2, color: '007FB0', align: 'center', valign: 'middle', margin: 0 },
    centeredBody: { fontFace: 'Arial', fontSize: 14, color: '64748B', align: 'center', margin: 0 },
    caption: { fontFace: 'Arial', fontSize: 12, color: '64748B', align: 'center', margin: 0 },
    note: { fontFace: 'Arial', fontSize: 11, italic: true, color: '64748B', margin: 0 },
    bodyLarge: { fontFace: 'Arial', fontSize: 18, color: '092033', margin: 0 },
    frameLabel: { fontFace: 'Arial', fontSize: 12, bold: true, color: '092033', align: 'center', margin: 0 },
    label: { fontFace: 'Arial', fontSize: 11, color: '64748B', margin: 0 },
    slideNumber: { fontFace: 'Arial', fontSize: 9, color: '092033', align: 'right', valign: 'mid', margin: 0 },
  },
  shapeStyles: {
    card: { fill: { color: 'FFFFFF' }, line: { color: 'D1D5DB', pt: 1 }, rectRadius: 0.08 },
    cardAlt: { fill: { color: 'F8FAFC' }, line: { color: 'D1D5DB', pt: 1 }, rectRadius: 0.08 },
    frame: { fill: { color: 'E2E8F0' }, line: { color: '94A3B8', pt: 1 } },
    brandRectBlue: { fill: { color: '007FB0' }, line: { color: '00608A', pt: 2 } },
    brandRectOrange: { fill: { color: 'F1792E', transparency: 28 }, line: { color: 'B45309', pt: 1 } },
    brandOvalGreen: { fill: { color: '006C3C' }, line: { color: '14532D', pt: 1.5 } },
    brandLineGreenDash: { line: { color: '14532D', pt: 2, dashType: 'dash' } },
    noFillInkLine: { line: { color: 'D1D5DB', pt: 1 } },
    slideNumberPatch: { fill: { color: 'E7E6E6' }, line: { color: 'E7E6E6', pt: 0 } },
  },
  effects: {
    cardShadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.12 },
    panelShadow: { type: 'outer', color: '000000', blur: 5, offset: 2, angle: 140, opacity: 0.2 },
  },
  chartDefaults: {
    barDir: 'col',
    chartColors: ['007FB0', '79D9FF', '006C3C', 'F1792E'],
    showLegend: false,
    showValue: true,
    dataLabelPosition: 'outEnd',
    dataLabelFontSize: 9,
    dataLabelFormatCode: '0.###',
    dataLabelColor: '1E293B',
    catAxisLabelColor: '64748B',
    valAxisLabelColor: '64748B',
    valAxisLabelFormatCode: '0.###',
    valGridLine: { color: 'E2E8F0', size: 0.75 },
    catGridLine: { style: 'none' },
  },
  listStyles: {
    bullet: {
      indentPt: 18,
      paraSpaceAfterPt: 8,
    },
  },
};

function textStyle(name, overrides = {}) {
  return { valign: 'top', ...FREEPORT_THEME.textStyles[name], ...overrides };
}

function shapeStyle(name, overrides = {}) {
  const base = FREEPORT_THEME.shapeStyles[name] || {};
  const style = {
    ...base,
    ...overrides,
    shadow: overrides.shadow || base.shadow,
  };
  const fill = { ...(base.fill || {}), ...(overrides.fill || {}) };
  const line = { ...(base.line || {}), ...(overrides.line || {}) };
  if (Object.keys(fill).length > 0) style.fill = fill;
  if (Object.keys(line).length > 0) style.line = line;
  if (!style.shadow) delete style.shadow;
  return style;
}

function chartStyle(overrides = {}) {
  return {
    ...FREEPORT_THEME.chartDefaults,
    ...overrides,
    valGridLine: { ...(FREEPORT_THEME.chartDefaults.valGridLine || {}), ...(overrides.valGridLine || {}) },
    catGridLine: { ...(FREEPORT_THEME.chartDefaults.catGridLine || {}), ...(overrides.catGridLine || {}) },
  };
}

function asset(name) {
  return path.join(__dirname, '..', 'assets', 'freeport-template', name);
}

function createFreeportPresentation() {
  const pres = new pptxgen();

  // Template is widescreen 13.333 x 7.5 in.
  pres.layout = 'LAYOUT_WIDE';
  pres.author = 'Freeport Defaults';
  pres.subject = 'Freeport template defaults for PptxGenJS';
  pres.company = 'Freeport-McMoRan';
  pres.defineSlideMaster({
    title: FREEPORT_MASTERS.TITLE,
    background: { color: FREEPORT_THEME.colors.white },
    objects: [
      {
        image: {
          path: asset('bg-title-master.png'),
          x: 0,
          y: 0,
          w: 13.333,
          h: 7.5,
        },
      },
    ],
  });
  pres.defineSlideMaster({
    title: FREEPORT_MASTERS.CONTENT,
    background: { color: FREEPORT_THEME.colors.white },
    objects: [
      {
        image: {
          path: asset('bg-content-master.png'),
          x: 0,
          y: 0,
          w: 13.333,
          h: 7.5,
        },
      },
    ],
  });
  return pres;
}

function applyContentBackground(slide, pres, slideNumber) {
  // Replace the baked "2" from the captured background with the real slide number.
  slide.addShape(pres.shapes.RECTANGLE, {
    ...FREEPORT_THEME.layout.slideNumberPatch,
    ...shapeStyle('slideNumberPatch'),
  });

  slide.addText(String(slideNumber), {
    ...FREEPORT_THEME.layout.slideNumberPatch,
    ...textStyle('slideNumber'),
  });
}

function addTitleSlide(pres, { title, subtitle } = {}) {
  const slide = pres.addSlide({ masterName: FREEPORT_MASTERS.TITLE });
  if (title) {
    slide.addText(title, {
      ...FREEPORT_THEME.layout.titleBox,
      ...textStyle('titleSlideTitle'),
    });
  }
  if (subtitle) {
    slide.addText(subtitle, {
      ...FREEPORT_THEME.layout.subtitleBox,
      ...textStyle('titleSlideSubtitle'),
    });
  }
  return slide;
}

function addContentSlide(pres, { title, body } = {}) {
  const slide = pres.addSlide({ masterName: FREEPORT_MASTERS.CONTENT });
  applyContentBackground(slide, pres, pres._slides.length);
  if (title) {
    slide.addText(title, {
      ...FREEPORT_THEME.layout.contentTitleBox,
      ...textStyle('contentTitle'),
    });
  }
  if (body) {
    slide.addText(body, {
      ...FREEPORT_THEME.layout.contentBodyBox,
      ...textStyle('contentBody'),
    });
  }
  return slide;
}

module.exports = {
  FREEPORT_MASTERS,
  FREEPORT_THEME,
  textStyle,
  shapeStyle,
  chartStyle,
  createFreeportPresentation,
  addTitleSlide,
  addContentSlide,
};
