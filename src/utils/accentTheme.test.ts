import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_COLOR,
  generateAccentRamp,
  getContrastTextColor,
  getWcagContrastRatio,
  normalizeHexColor,
} from './accentTheme';

test('normalizeHexColor validates 3-digit, 6-digit, and invalid strings', () => {
  assert.equal(normalizeHexColor('#1D4ED8'), '#1d4ed8');
  assert.equal(normalizeHexColor('abc'), '#aabbcc');
  assert.equal(normalizeHexColor(' #047857 '), '#047857');
  assert.equal(normalizeHexColor('not-a-color'), null);
  assert.equal(normalizeHexColor(''), null);
});

test('generateAccentRamp produces full 11-shade scale with WCAG AA >= 4.5:1 for white text on 700/800', () => {
  for (const preset of ACCENT_PRESETS) {
    const ramp = generateAccentRamp(preset.hex);
    assert.ok(ramp[50].startsWith('#'));
    assert.ok(ramp[950].startsWith('#'));
    assert.ok(
      getWcagContrastRatio('#ffffff', ramp[700]) >= 4.5,
      `Expected shade 700 contrast >= 4.5 for ${preset.name} (${ramp[700]})`
    );
    assert.ok(
      getWcagContrastRatio('#ffffff', ramp[800]) >= 4.5,
      `Expected shade 800 contrast >= 4.5 for ${preset.name} (${ramp[800]})`
    );
  }
});

test('generateAccentRamp handles very bright custom brand colors safely', () => {
  const brightRamp = generateAccentRamp('#fde047'); // bright yellow
  assert.ok(getWcagContrastRatio('#ffffff', brightRamp[700]) >= 4.5);
  assert.equal(getContrastTextColor('#ffffff'), '#0f172a');
  assert.equal(getContrastTextColor(DEFAULT_ACCENT_COLOR), '#ffffff');
});
