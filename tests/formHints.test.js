/**
 * Box form: the disabled save button says which required fields are still missing.
 * Pure part of public/js/form-hints.js (the DOM lookup is checked by clicking).
 */
const { missingLabels, formatMissing } = require('../public/js/form-hints');

describe('missingLabels', () => {
  test('lists only invalid fields, in form order, without duplicates', () => {
    expect(missingLabels([
      { valid: true,  label: 'Box Alias' },
      { valid: false, label: 'Replacement Reminder (LMF)' },
      { valid: false, label: 'Target temperature' },
      { valid: false, label: 'Target temperature' }
    ])).toEqual(['Replacement Reminder (LMF)', 'Target temperature']);
  });

  test('invalid field without a label is still counted, not silently dropped', () => {
    expect(missingLabels([{ valid: false, label: '' }])).toEqual(['a required field']);
  });

  test('everything valid -> nothing missing', () => {
    expect(missingLabels([{ valid: true, label: 'Box Alias' }])).toEqual([]);
  });
});

describe('formatMissing', () => {
  test('names the missing fields', () => {
    expect(formatMissing(['Replacement Reminder (LMF)', 'Target temperature']))
      .toBe('Still missing: Replacement Reminder (LMF), Target temperature.');
  });
  test('empty when nothing is missing', () => {
    expect(formatMissing([])).toBe('');
  });
});
