// core/summary.js
// Renders the headline results. Domain-free: it knows only SummaryItem.

/**
 * @param {import('./contract.js').SummaryItem[]} items
 * @param {HTMLElement} container
 */
export function drawSummary(items, container) {
  if (!container) return;
  container.replaceChildren();
  container.classList.add('summary');

  items.forEach((it) => {
    const card = document.createElement('div');
    card.className = it.primary ? 'summary-item summary-primary' : 'summary-item';

    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = it.label;

    const value = document.createElement('strong');
    value.className = 'summary-value';
    value.textContent = it.value;

    card.append(label, value);
    container.append(card);
  });
}
