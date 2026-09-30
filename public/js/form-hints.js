// Nennt unter einem gesperrten Speichern-Knopf die noch fehlenden Pflichtfelder.
// Reiner Teil (missingLabels, formatMissing) ist in Jest getestet; labelOf/describe lesen das DOM.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FormHints = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // fields: [{ valid, label }] in Formular-Reihenfolge
  function missingLabels(fields) {
    const out = [];
    for (const f of fields) {
      if (f.valid) continue;
      const label = (f.label || '').trim() || 'a required field';
      if (!out.includes(label)) out.push(label);
    }
    return out;
  }

  function formatMissing(labels) {
    return labels.length ? 'Still missing: ' + labels.join(', ') + '.' : '';
  }

  // Beschriftung eines Feldes: <label for=id>, sonst die Gruppen-Beschriftung (z. B. Optionsfelder)
  function labelOf(el) {
    let label = el.id ? el.form.querySelector('label[for="' + el.id + '"]') : null;
    if (!label) {
      const group = el.closest('.form-group');
      label = group ? group.querySelector(':scope > label:not(.choice-card)') : null;
    }
    return label ? label.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function describe(form) {
    const fields = Array.from(form.elements)
      .filter(el => el.willValidate)
      .map(el => ({ valid: el.checkValidity(), label: labelOf(el) }));
    return formatMissing(missingLabels(fields));
  }

  return { missingLabels, formatMissing, describe };
});
