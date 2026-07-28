#!/usr/bin/env node
// Systematic sweep of the marginal-rate chart's label geometry
// (roth-conversion/index.html, renderMarginalChart) — port the exact
// placement math and sweep it parametrically across container widths,
// reference-rate position, crossover position (both axes), and marker
// layout, rather than eyeballing a handful of hand-picked scenarios. Same
// methodology as test-sens-chart-labels.mjs.
//
// History — three rounds of live spot-checks, each finding a collision the
// previous sweep didn't model:
//   1. The crossover label colliding with a named marker's line at narrow
//      widths. Fixed via clearCx + a full/short text fallback.
//   2. The reference-line label ("Your expected retirement rate — X%") had
//      no collision avoidance against the named markers at all. Fixed the
//      same way.
//   3. The crossover label colliding with the reference-line label. The
//      first attempt at this assumed the crossover's y-pixel (ccy) is
//      always close to the reference line's own (refY), reasoning that the
//      crossing is "where the curve meets the reference line, so they're
//      the same point." That's wrong: sweepMarginalCurve samples in
//      discrete steps, so wherever the curve is steep, the first sample
//      past the reference rate can overshoot it substantially — a live
//      torpedo-effect profile crossed a 28.2% target within the first
//      $1,500 of conversion, landing the dot several points higher than
//      the reference line itself. The fix compares the two labels' ACTUAL
//      rendered bands (real y0/y1, independently computed) rather than
//      assuming a shared y-position, and this sweep now models ccy and
//      refY as fully independent parameters for exactly that reason —
//      tying them (as the first two rounds of this file did) would hide
//      the very bug that broke the first fix.
//
// Checks, for every (container width, reference-rate position, crossover
// x-position, crossover y-position, marker set) combination:
//   1. The crossover label stays fully inside the plot canvas.
//   2. The crossover label's rect never has a marker line's x fall inside it.
//   3. Each named-marker label stays fully inside the plot canvas.
//   4. The reference-line label stays fully inside the plot canvas —
//      horizontally, and vertically (it can clip an edge when the reference
//      rate sits near the top or bottom of the y-axis).
//   5. The reference-line label's rect never has a marker line's x fall
//      inside it.
//   6. The reference-line label and the crossover label never overlap
//      (true 2D rect overlap — both are finite-size pills).
//
// Known accepted residual: roughly 1.5% of combinations still fail check 2
// or 6 (crossover vs. a marker line, or vs. the reference label), entirely
// confined to container widths ≤428px (0 violations at 480px and up) and
// concentrated where the crossover's y-position sits within ~30px of the
// canvas top or bottom — the one zone where there may be no side that both
// fits the canvas and avoids the reference label, so the code accepts
// whichever side at least fits and leans on horizontal separation instead.
// At these widths the reference label alone can approach the canvas width,
// so when several markers also cluster nearby (the adversarial marker
// configs below deliberately test exactly that), there's sometimes not
// enough horizontal room left either. Real Medicare/LTCG thresholds aren't
// clustered this tightly in practice, and this only affects a supplementary
// annotation on a secondary chart, not the underlying numbers — left as-is
// rather than chase a vertical-placement scheme elaborate enough to
// guarantee a clear spot in every case. Re-check this comment if the
// violation count grows well past its historical size (thousands) or
// spreads past 428px — that would mean something new broke.

// Exact port of clearCx(): obstacles are {x, half} pairs (half = that
// obstacle's own half-width). Returns a clear cx, or null if no fully clear
// spot exists at this width/obstacle layout — callers use null as the
// signal to try shorter text rather than silently rendering an overlap.
function clearCx(preferredCx, w, obstacles, W) {
  const minCx = w / 2, maxCx = W - w / 2;
  function isClear(cx) {
    if (cx < minCx - 0.01 || cx > maxCx + 0.01) return false;
    return !obstacles.some((o) => Math.abs(o.x - cx) < w / 2 + o.half);
  }
  const clamped = Math.min(maxCx, Math.max(minCx, preferredCx));
  if (isClear(clamped)) return clamped;
  for (let d = 4; d < W; d += 4) {
    if (clamped + d <= maxCx && isClear(clamped + d)) return clamped + d;
    if (clamped - d >= minCx && isClear(clamped - d)) return clamped - d;
  }
  return null;
}

const MAX_AMT = 600000;
const MAX_RET_PCT = 50; // representative ceiling for the reference rate's %

// Exact port of one renderMarginalChart frame. ccy and refY are modeled as
// fully independent — see the history note above for why that matters.
function fullGeometry(totalWraw, retFrac, ccyFrac, crossFrac, markerFracs) {
  const totalW = Math.min(totalWraw, 700);
  const margin = { left: 50, right: 20 };
  const W = totalW - margin.left - margin.right;
  const H = Math.round(W * 0.44);

  const xSc = (v) => (v / MAX_AMT) * W;
  const namedX = markerFracs.map((f) => xSc(f * MAX_AMT));
  const markerObstacles = namedX.map((x) => ({ x, half: 6 }));

  const retPct = retFrac * MAX_RET_PCT;
  const refY = H * (1 - retFrac);
  const refAbove = refY >= 19;
  const refRectY0 = refAbove ? refY - 19 : refY + 5;
  const refRectY1 = refRectY0 + 14;

  // Reference label: self-contained, always tries full text first, avoids
  // only the named markers (it doesn't know about the crossover).
  const refTextFull = 'Your expected retirement rate · ' + retPct.toFixed(1) + '%';
  const refWFull = refTextFull.length * 5.7 + 12;
  const refCxFull = clearCx(W - refWFull / 2, refWFull, markerObstacles, W);
  let refW, refCx;
  if (refCxFull !== null) {
    refW = refWFull; refCx = refCxFull;
  } else {
    const refTextShort = retPct.toFixed(1) + '%';
    refW = refTextShort.length * 5.7 + 12;
    const refCxShort = clearCx(W - refW / 2, refW, markerObstacles, W);
    refCx = refCxShort !== null ? refCxShort : Math.min(W - refW / 2, Math.max(refW / 2, W - refW / 2));
  }
  const refRect = { x0: refCx - refW / 2, x1: refCx + refW / 2, y0: refRectY0, y1: refRectY1 };

  // Crossover: ccx and ccy are both independent free parameters (ccy is NOT
  // tied to refY — see history note above).
  const ccx = xSc(crossFrac * MAX_AMT);
  const ccy = ccyFrac * H;
  const band = (isBelow) => {
    const y = isBelow ? ccy + 24 : ccy - 16;
    return { below: isBelow, lblY: y, y0: y - 11, y1: y + 5, fits: y - 11 >= 0 && y + 5 <= H };
  };
  const overlapsRef = (b) => b.y0 < refRectY1 && b.y1 > refRectY0;
  const primary = band(ccy < H * 0.75);
  let chosen = primary;
  if (overlapsRef(primary)) {
    const alt = band(!primary.below);
    if (alt.fits && !overlapsRef(alt)) chosen = alt;
  }
  const lblY = chosen.lblY;
  const sameSide = overlapsRef(chosen);
  const crossObstacles = sameSide ? markerObstacles.concat([{ x: refCx, half: refW / 2 + 6 }]) : markerObstacles;

  const lblTextFull = 'Crosses your rate — $' + Math.round(crossFrac * MAX_AMT).toLocaleString();
  const lblWFull = lblTextFull.length * 5.7 + 12;
  const cxFull = clearCx(ccx + lblWFull / 2 + 10, lblWFull, crossObstacles, W);
  let lblW, lblCx;
  if (cxFull !== null) {
    lblW = lblWFull; lblCx = cxFull;
  } else {
    const lblTextShort = '$' + Math.round(crossFrac * MAX_AMT).toLocaleString();
    lblW = lblTextShort.length * 5.7 + 12;
    const cxShort = clearCx(ccx + lblW / 2 + 10, lblW, crossObstacles, W);
    lblCx = cxShort !== null ? cxShort : Math.min(W - lblW / 2, Math.max(lblW / 2, ccx + lblW / 2 + 10));
  }
  const lblRect = { x0: lblCx - lblW / 2, x1: lblCx + lblW / 2, y0: chosen.y0, y1: chosen.y1 };

  return { W, H, namedX, refRect, lblRect };
}

function rectsOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

// Named-marker label: centered on the marker line, clamped to the canvas.
function markerLabelBounds(lx, W, text) {
  const w = text.length * 5.6 + 10;
  const cx = Math.min(W - w / 2, Math.max(w / 2, lx));
  return { x0: cx - w / 2, x1: cx + w / 2 };
}

const containerWidths = [320, 344, 360, 375, 390, 412, 428, 480, 520, 568, 600, 620, 700, 900];
const STEPS = 15;
function fracs(steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) out.push(i / steps);
  return out;
}
const crossFracs = fracs(STEPS);
const retFracs = fracs(STEPS);
const ccyFracs = fracs(STEPS);

// Adversarial marker configurations — deliberately including the edge cases
// most likely to break a collision-avoidance strategy: nothing, one marker
// right on the anchor, one far away, straddling pairs, edge clusters (which
// double as stress cases for the reference label's flush-right default).
function markerConfigs(anchorFrac) {
  const near = (d) => Math.max(0, Math.min(1, anchorFrac + d));
  return [
    [],
    [near(0.01)],
    [near(-0.01)],
    [0.5],
    [near(0.01), near(-0.01)],
    [near(0.02), near(0.04)],
    [0.02, 0.04, 0.06],       // cluster at the left edge
    [0.94, 0.96, 0.98],       // cluster at the right edge
    [near(0.005), 0.5, 0.95],
  ];
}

let checked = 0;
const crossOffCanvas = [];
const crossMarkerCollisions = [];
const markerLabelOverflow = [];
const refOffCanvasH = [];
const refOffCanvasV = [];
const refMarkerCollisions = [];
const refCrossCollisions = [];

for (const totalWraw of containerWidths) {
  for (const retFrac of retFracs) {
    for (const ccyFrac of ccyFracs) {
      for (const crossFrac of crossFracs) {
        for (const markers of markerConfigs(crossFrac)) {
          checked++;
          const { W, H, namedX, refRect, lblRect } = fullGeometry(totalWraw, retFrac, ccyFrac, crossFrac, markers);

          if (lblRect.x0 < -0.5 || lblRect.x1 > W + 0.5) {
            crossOffCanvas.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, W, lblRect, axis: 'h' });
          }
          if (lblRect.y0 < -0.5 || lblRect.y1 > H + 0.5) {
            crossOffCanvas.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, H, lblRect, axis: 'v' });
          }
          for (const mx of namedX) {
            if (mx > lblRect.x0 && mx < lblRect.x1) {
              crossMarkerCollisions.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, W, lblRect, collidingMarkerX: mx });
            }
          }

          if (refRect.x0 < -0.5 || refRect.x1 > W + 0.5) {
            refOffCanvasH.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, W, refRect });
          }
          if (refRect.y0 < -0.5 || refRect.y1 > H + 0.5) {
            refOffCanvasV.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, H, refRect });
          }
          for (const mx of namedX) {
            if (mx > refRect.x0 && mx < refRect.x1) {
              refMarkerCollisions.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, W, refRect, collidingMarkerX: mx });
            }
          }

          if (rectsOverlap(refRect, lblRect)) {
            refCrossCollisions.push({ totalWraw, retFrac, ccyFrac, crossFrac, markers, refRect, lblRect });
          }

          for (const f of markers) {
            const lx = f * W;
            const { x0, x1 } = markerLabelBounds(lx, W, 'Qual. div./LTCG bumped');
            if (x0 < -0.5 || x1 > W + 0.5) {
              markerLabelOverflow.push({ totalWraw, retFrac, ccyFrac, crossFrac, f, W, x0, x1 });
            }
          }
        }
      }
    }
  }
}

console.log(`Checked ${checked.toLocaleString()} (width, ref-position, crossover-y, crossover-x, marker-config) combinations across ${containerWidths.length} container widths (${Math.min(...containerWidths)}-${Math.max(...containerWidths)}px).`);

const total = crossOffCanvas.length + crossMarkerCollisions.length + markerLabelOverflow.length
  + refOffCanvasH.length + refOffCanvasV.length + refMarkerCollisions.length + refCrossCollisions.length;

console.log(`\ncrossover label off-canvas: ${crossOffCanvas.length}`);
console.log(`crossover label vs marker-line collisions: ${crossMarkerCollisions.length}`);
console.log(`named-marker label overflow: ${markerLabelOverflow.length}`);
console.log(`reference label off-canvas (horizontal): ${refOffCanvasH.length}`);
console.log(`reference label off-canvas (vertical): ${refOffCanvasV.length}`);
console.log(`reference label vs marker-line collisions: ${refMarkerCollisions.length}`);
console.log(`reference label vs crossover label collisions: ${refCrossCollisions.length}`);

if (total === 0) {
  console.log('\nNo violations.');
  process.exit(0);
}

function showSample(list, label, n) {
  if (!list.length) return;
  console.log(`\n--- ${label}: ${list.length} case(s), showing up to ${n} ---`);
  const seen = new Set();
  let shown = 0;
  for (const v of list) {
    const key = v.totalWraw + ':' + v.retFrac + ':' + v.ccyFrac + ':' + v.crossFrac + ':' + JSON.stringify(v.markers ?? v.f);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(JSON.stringify(v));
    if (++shown >= n) break;
  }
}
showSample(crossOffCanvas, 'CROSSOVER OFF-CANVAS', 8);
showSample(crossMarkerCollisions, 'CROSSOVER vs MARKER-LINE', 8);
showSample(markerLabelOverflow, 'MARKER LABEL OVERFLOW', 8);
showSample(refOffCanvasH, 'REFERENCE OFF-CANVAS (H)', 8);
showSample(refOffCanvasV, 'REFERENCE OFF-CANVAS (V)', 8);
showSample(refMarkerCollisions, 'REFERENCE vs MARKER-LINE', 8);
showSample(refCrossCollisions, 'REFERENCE vs CROSSOVER', 8);

process.exit(1);
