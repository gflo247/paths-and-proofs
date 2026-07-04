// core/chart.js
// The shared sensitivity chart. Domain-free: it draws whatever ComputeResult it
// is handed. Colors come from the series and from CSS variables on the container,
// so light/dark theming is automatic. Requires D3 version 7 (global `d3`,
// loaded by script tag) and the shared findCrossover primitive.

import { findCrossover } from './finance.js';

const MARGIN = { top: 16, right: 16, bottom: 44, left: 60 };

/** Read a CSS custom property off the container, with a fallback. */
function token(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * @param {import('./contract.js').ComputeResult} result
 * @param {HTMLElement} container
 */
export function drawChart(result, container) {
  const d3 = globalThis.d3;
  if (!d3) throw new Error('D3 version 7 must be loaded before drawChart runs.');
  if (!container) return;

  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const desktop = (globalThis.innerWidth || 0) >= 900;
  const HEIGHT = desktop ? 420 : 320; // logical height; wider desktop layouts get a taller chart
  const width = Math.max(container.clientWidth || 600, 280);
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const grid = token(container, '--chart-grid', '#e3e3e3');
  const ink  = token(container, '--chart-text', '#555');
  const tipBg = token(container, '--chart-tooltip-bg', '#1f2430');
  const tipInk = token(container, '--chart-tooltip-text', '#f5f5f5');

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.replaceChildren();

  const { series, xAxis, yAxis } = result;
  const xValues = series[0].points.map((p) => p.x);
  const x = d3.scaleLinear().domain(d3.extent(xValues)).range([0, innerW]);
  const yMax = d3.max(series, (s) => d3.max(s.points, (p) => p.y)) || 1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', HEIGHT)
    .attr('viewBox', `0 0 ${width} ${HEIGHT}`)
    .attr('role', 'img')
    .attr('aria-label',
      `${yAxis?.label ?? 'value'} versus ${xAxis.label}, ${series.length} lines`);

  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  // Axes — quiet gridlines, plain labels.
  g.append('g').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => xAxis.format(d)).tickSizeOuter(0))
    .call((sel) => sel.selectAll('text').attr('fill', ink));
  g.append('g')
    .call(d3.axisLeft(y).ticks(5)
      .tickFormat((d) => (yAxis ? yAxis.format(d) : d)).tickSize(-innerW).tickSizeOuter(0))
    .call((sel) => {
      sel.selectAll('line').attr('stroke', grid);
      sel.selectAll('text').attr('fill', ink);
      sel.select('.domain').remove();
    });
  g.append('text').attr('x', innerW / 2).attr('y', innerH + 38)
    .attr('text-anchor', 'middle').attr('fill', ink).attr('font-size', desktop ? 14 : 12).text(xAxis.label);

  // Lines — monotone curve avoids overshoot that would misstate money.
  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  series.forEach((s) => {
    const path = g.append('path').datum(s.points)
      .attr('fill', 'none').attr('stroke', s.color || ink)
      .attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('d', line);
    if (!reduceMotion) {
      const len = path.node().getTotalLength();
      path.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(650).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);
    }
  });

  // Crossovers — mark the declared breakevens (default: first vs last).
  const specs = result.crossovers
    ?? (series.length >= 2 ? [{ from: 0, to: series.length - 1 }] : []);
  specs.forEach((c) => {
    const at = findCrossover(series[c.from], series[c.to]);
    if (at == null) return;
    g.append('line').attr('x1', x(at)).attr('x2', x(at)).attr('y1', 0).attr('y2', innerH)
      .attr('stroke', ink).attr('stroke-dasharray', '4 4').attr('opacity', 0.6);
    g.append('text').attr('x', x(at)).attr('y', -4).attr('text-anchor', 'middle')
      .attr('fill', ink).attr('font-size', desktop ? 13 : 11)
      .text(`${xAxis.format(at)}${c.label ? ` — ${c.label}` : ''}`);
  });

  // Markers — optional vertical reference lines at given x positions (e.g. a
  // planning age). Generic: the core draws whatever {x, label, color} points it
  // is handed and knows nothing about what they mean. Drawn solid and subtle so
  // they read as "you are here" anchors, distinct from the dashed crossover.
  (result.markers ?? []).forEach((mk) => {
    if (mk.x == null || mk.x < x.domain()[0] || mk.x > x.domain()[1]) return;
    const mInk = mk.color || ink;
    g.append('line').attr('x1', x(mk.x)).attr('x2', x(mk.x)).attr('y1', 0).attr('y2', innerH)
      .attr('stroke', mInk).attr('stroke-width', 1).attr('opacity', 0.45);
    if (mk.label) {
      g.append('text').attr('x', x(mk.x)).attr('y', innerH - 6).attr('text-anchor', 'middle')
        .attr('fill', mInk).attr('font-size', desktop ? 12 : 10).attr('opacity', 0.85).text(mk.label);
    }
  });

  // Hover readout — guideline plus a value for each line at the pointer.
  const guide = g.append('line').attr('y1', 0).attr('y2', innerH)
    .attr('stroke', ink).attr('opacity', 0).attr('pointer-events', 'none');
  const dots = series.map((s) => g.append('circle').attr('r', 4)
    .attr('fill', s.color || ink).attr('opacity', 0).attr('pointer-events', 'none'));
  const tip = d3.select(container).append('div')
    .attr('role', 'status')
    .style('position', 'absolute').style('pointer-events', 'none').style('opacity', 0)
    .style('background', tipBg).style('color', tipInk)
    .style('padding', '8px 10px').style('border-radius', '8px')
    .style('font-size', '12px').style('line-height', '1.4').style('white-space', 'nowrap')
    .style('transform', 'translate(-50%, calc(-100% - 12px))');

  const bisect = d3.bisector((d) => d).center;
  function moveTo(px) {
    const xv = x.invert(px);
    const i = bisect(xValues, xv);
    const xx = xValues[i];
    guide.attr('x1', x(xx)).attr('x2', x(xx)).attr('opacity', 0.4);
    let rows = `<strong>${xAxis.label}: ${xAxis.format(xx)}</strong>`;
    series.forEach((s, k) => {
      const p = s.points[i];
      dots[k].attr('cx', x(p.x)).attr('cy', y(p.y)).attr('opacity', 1);
      const val = yAxis ? yAxis.format(p.y) : Math.round(p.y);
      rows += `<br>${s.name}: ${val}`;
    });
    tip.html(rows).style('opacity', 1)
      .style('left', `${MARGIN.left + x(xx)}px`).style('top', `${MARGIN.top + y(yMax)}px`);
  }
  function hide() {
    guide.attr('opacity', 0); dots.forEach((d) => d.attr('opacity', 0)); tip.style('opacity', 0);
  }

  g.append('rect').attr('width', innerW).attr('height', innerH)
    .attr('fill', 'transparent').attr('tabindex', 0)
    .attr('aria-label', `Explore values along ${xAxis.label} with the arrow keys`)
    .on('pointermove', (e) => moveTo(d3.pointer(e)[0]))
    .on('pointerleave', hide)
    .on('keydown', (e) => {
      const step = innerW / 40;
      const cur = guide.attr('opacity') > 0 ? x(x.invert(+guide.attr('x1'))) : 0;
      if (e.key === 'ArrowRight') { moveTo(Math.min(cur + step, innerW)); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { moveTo(Math.max(cur - step, 0)); e.preventDefault(); }
    });

  // Redraw on resize so it stays crisp and mobile-friendly.
  if (!container._chartObserver && globalThis.ResizeObserver) {
    container._chartObserver = new ResizeObserver(() => drawChart(result, container));
    container._chartObserver.observe(container);
  }
}
