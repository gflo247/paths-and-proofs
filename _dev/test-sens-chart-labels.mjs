#!/usr/bin/env node
// Systematic sweep of the sensitivity-chart "your situation" label geometry
// (roth-conversion/index.html, renderSensChart). Ports the exact placement
// math rather than driving a browser, since jsdom doesn't compute real SVG
// text metrics — this tests the geometry itself across every container
// width and dot position, not just the handful of built-in examples.
//
// Checks, for every (container width, growth rate, retirement rate,
// all-green or not) combination:
//   1. The label pill stays fully inside the plot canvas.
//   2. When pctRoth===100, the label pill never overlaps the "Roth wins
//      everywhere" banner (checked on both axes — the app's own `hits()`
//      only checks the y-axis, so this also verifies that blind spot never
//      produces a real collision).
//   3. The label pill never overlaps the bottom-left legend strip.

const gRange = [0.01, 0.13];
const rRange = [0.05, 0.45];

function scaleLinear(domain, range) {
  return (v) => range[0] + (v - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Port of the exact label-placement branch (index.html ~1568-1591).
function labelGeometry(g, r, W, H, pctRoth) {
  const xSc = scaleLinear(gRange, [0, W]);
  const ySc = scaleLinear([rRange[1], rRange[0]], [0, H]); // inverted, matches source

  const dotG = clamp(g, gRange[0], gRange[1]);
  const dotR = clamp(r, rRange[0], rRange[1]);
  const dx = xSc(dotG), dy = ySc(dotR);
  const outside = g < gRange[0] || g > gRange[1] || r < rRange[0] || r > rRange[1];

  let lblDy;
  if (pctRoth === 100) {
    const bTop = H * 0.18 - 18, bBot = H * 0.18 + 32, pad = 10;
    const hits = (cand) => { const top = dy + cand - 12, bot = top + 16; return bot > bTop - pad && top < bBot + pad; };
    if (!hits(-26) && dy - 26 > 12) lblDy = -26;
    else if (!hits(22)) lblDy = 22;
    else lblDy = (bBot + pad + 6) - dy;
  } else {
    lblDy = (dy > H * 0.65) ? -26 : 22;
  }

  const lblW = outside ? 162 : 88;
  const lblCx = Math.max(lblW / 2, Math.min(W - lblW / 2, dx));
  const pillLeft = lblCx - lblW / 2, pillRight = lblCx + lblW / 2;
  const pillYMax = (pillRight > 4 && pillLeft < 94) ? H - 13 - 16 - 2 : H - 16;
  const pillY = Math.max(0, Math.min(pillYMax, dy + lblDy - 12));
  const pill = { x: lblCx - lblW / 2, y: pillY, w: lblW, h: 16 };
  return { dx, dy, pill, outside };
}

function bannerRect(W, H) {
  return { x: W / 2 - 112, y: H * 0.18 - 18, w: 224, h: 50 };
}

function legendRect(H) {
  return { x: 4, y: H - 9 - 4, w: 90, h: 9 };
}

// Container widths spanning small phones through the chart's own 620px cap
// (and beyond, to confirm the cap holds).
const containerWidths = [320, 344, 360, 375, 390, 412, 428, 480, 520, 568, 600, 620, 700, 900];
const margin = { left: 58, right: 22 };

const STEPS = 60;
function sweepValues(range, pad) {
  const lo = range[0] - pad, hi = range[1] + pad;
  const out = [];
  for (let i = 0; i <= STEPS; i++) out.push(lo + (hi - lo) * i / STEPS);
  return out;
}
const gVals = sweepValues(gRange, 0.02);
const rVals = sweepValues(rRange, 0.06);

const TOLERANCE = 0.5; // px; sub-pixel rounding noise only
let checked = 0;
const violations = [];

for (const totalWraw of containerWidths) {
  const totalW = Math.min(totalWraw, 620);
  const W = totalW - margin.left - margin.right;
  const H = Math.round(W * 0.56);
  const banner = bannerRect(W, H);
  const legend = legendRect(H);

  for (const pctRoth of [100, 50]) {
    for (const g of gVals) {
      for (const r of rVals) {
        checked++;
        const { pill, dx, dy, outside } = labelGeometry(g, r, W, H, pctRoth);

        if (pill.x < -TOLERANCE || pill.x + pill.w > W + TOLERANCE ||
            pill.y < -TOLERANCE || pill.y + pill.h > H + TOLERANCE) {
          violations.push({
            type: 'off-canvas', totalWraw, W, H, pctRoth, g, r, dx, dy, pill,
          });
        }
        if (pctRoth === 100 && rectsOverlap(pill, banner)) {
          violations.push({
            type: 'banner-overlap', totalWraw, W, H, pctRoth, g, r, dx, dy, pill, banner,
          });
        }
        if (rectsOverlap(pill, legend)) {
          violations.push({
            type: 'legend-overlap', totalWraw, W, H, pctRoth, g, r, dx, dy, pill, legend, outside,
          });
        }
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} (width, growth-rate, retirement-rate, banner-state) combinations across ${containerWidths.length} container widths (${Math.min(...containerWidths)}-${Math.max(...containerWidths)}px).`);

if (violations.length === 0) {
  console.log('No violations: label pill always stays on-canvas and never overlaps the all-green banner or the legend strip.');
  process.exit(0);
}

const byType = {};
for (const v of violations) byType[v.type] = (byType[v.type] || 0) + 1;
console.log(`\n${violations.length} violation(s) found:`, byType);

const seen = new Set();
let shown = 0;
for (const v of violations) {
  const key = `${v.type}:${v.totalWraw}:${v.pctRoth}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n[${v.type}] containerWidth=${v.totalWraw} plotW=${v.W} plotH=${v.H} pctRoth=${v.pctRoth}`);
  console.log(`  growth=${v.g.toFixed(4)} retRate=${v.r.toFixed(4)} -> dot=(${v.dx.toFixed(1)},${v.dy.toFixed(1)})`);
  console.log(`  pill=${JSON.stringify(v.pill)}`);
  if (v.banner) console.log(`  banner=${JSON.stringify(v.banner)}`);
  if (v.legend) console.log(`  legend=${JSON.stringify(v.legend)}`);
  shown++;
  if (shown >= 12) { console.log(`\n...and ${violations.length - shown} more (deduplicated by type+width+pctRoth above).`); break; }
}

process.exit(1);
