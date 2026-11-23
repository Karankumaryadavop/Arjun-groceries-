import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSampleThermalReceipt,
  buildThermalPrintDocumentHtml,
  DEFAULT_THERMAL_PRINT_CONFIG,
  normalizeThermalPrintConfig,
  validateThermalLogoDataUrl,
} from './thermalPrint';
import { StoreProfile } from '../types';

const sampleProfile: StoreProfile = {
  id: 'store-1',
  storeName: 'Arjun Groceries',
  ownerName: 'Arjun Verma',
  phone: '9876543210',
  upiId: 'arjungroceries@upi',
  address: 'Shop 12, Main Market, Pune',
  gstin: '27ABCDE1234F1Z5',
  currencySymbol: '₹',
  isPinEnabled: false,
};

test('normalizeThermalPrintConfig enforces bounds, cleans multiline headers/footers, and validates custom logo', () => {
  const cfg = normalizeThermalPrintConfig({
    paperWidth: '58mm',
    logoHeightPx: 999,
    logoMode: 'CUSTOM',
    customLogoDataUrl: 'javascript:alert(1)',
    headerAlignment: 'LEFT',
    headerTitle: '  Arjun Super Mart  ',
    headerLines: ['  Line 1  ', '', '  Line 2 '],
    footerLines: ['  Thanks!  ', '   ', 'Exchange in 24h'],
    showGstin: false,
  });

  assert.equal(cfg.paperWidth, '58mm');
  assert.equal(cfg.logoHeightPx, 84);
  assert.equal(cfg.logoMode, 'DEFAULT'); // invalid data URL rejected
  assert.equal(cfg.customLogoDataUrl, undefined);
  assert.equal(cfg.headerAlignment, 'LEFT');
  assert.equal(cfg.headerTitle, 'Arjun Super Mart');
  assert.deepEqual(cfg.headerLines, ['Line 1', 'Line 2']);
  assert.deepEqual(cfg.footerLines, ['Thanks!', 'Exchange in 24h']);
  assert.equal(cfg.showGstin, false);
});

test('validateThermalLogoDataUrl accepts safe base64 image data URLs and rejects oversized or unsafe strings', () => {
  assert.equal(validateThermalLogoDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(validateThermalLogoDataUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
  assert.equal(validateThermalLogoDataUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  assert.equal(validateThermalLogoDataUrl('https://evil.example/logo.png'), false);
});

test('buildThermalPrintDocumentHtml renders custom headers, footers, 58mm page width, and escapes HTML', () => {
  const config = normalizeThermalPrintConfig({
    ...DEFAULT_THERMAL_PRINT_CONFIG,
    paperWidth: '58mm',
    headerLines: ['FSSAI #998877', '<script>alert(1)</script>'],
    footerLines: ['Visit Arjun Groceries Again!'],
    showGstin: true,
    showUpiId: true,
  });

  const receipt = buildSampleThermalReceipt(sampleProfile);
  const html = buildThermalPrintDocumentHtml({
    profile: sampleProfile,
    config,
    receipt,
  });

  assert.ok(html.includes('@page { size: 58mm auto;'));
  assert.ok(html.includes('FSSAI #998877'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('Visit Arjun Groceries Again!'));
  assert.ok(html.includes('27ABCDE1234F1Z5'));
  assert.ok(html.includes('arjungroceries@upi'));
});
