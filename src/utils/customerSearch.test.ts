import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProjectedUdharBalance,
  filterCustomersForQuickSale,
  normalizePhoneDigits,
} from './customerSearch';
import { Customer } from '../types';

const sampleCustomers: Customer[] = [
  {
    id: 'c-1',
    name: 'Ramesh Bhai Patel',
    phone: '9876543210',
    openingBalance: 1000,
    currentBalance: 3450,
    totalCreditGiven: 3450,
    totalPaymentReceived: 1000,
    overdueDays: 4,
    category: 'REGULAR',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'c-2',
    name: 'Sunita Sharma',
    phone: '+91 98201-98765',
    openingBalance: 0,
    currentBalance: 6800,
    totalCreditGiven: 6800,
    totalPaymentReceived: 0,
    overdueDays: 45,
    category: 'OVERDUE',
    createdAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'c-3',
    name: 'Rajesh Verma',
    phone: '9930456123',
    openingBalance: 0,
    currentBalance: 0,
    totalCreditGiven: 500,
    totalPaymentReceived: 500,
    overdueDays: 0,
    category: 'CLEARED',
    createdAt: '2026-01-03T00:00:00Z',
  },
];

test('filterCustomersForQuickSale searches case-insensitively by full name, partial name, and mobile digits', () => {
  assert.equal(filterCustomersForQuickSale(sampleCustomers, '').length, 3);

  const byPartialName = filterCustomersForQuickSale(sampleCustomers, 'patel');
  assert.equal(byPartialName.length, 1);
  assert.equal(byPartialName[0].id, 'c-1');

  const byCaseInsensitive = filterCustomersForQuickSale(sampleCustomers, 'SUNITA');
  assert.equal(byCaseInsensitive.length, 1);
  assert.equal(byCaseInsensitive[0].id, 'c-2');

  const byFormattedPhone = filterCustomersForQuickSale(sampleCustomers, '9820198765');
  assert.equal(byFormattedPhone.length, 1);
  assert.equal(byFormattedPhone[0].id, 'c-2');

  const byPrefix = filterCustomersForQuickSale(sampleCustomers, 'ra');
  assert.equal(byPrefix.length, 2);
  assert.equal(byPrefix[0].id, 'c-3'); // Rajesh starts with 'ra' -> ranked cleanly

  const noMatch = filterCustomersForQuickSale(sampleCustomers, 'nonexistent-xyz');
  assert.equal(noMatch.length, 0);
});

test('filterCustomersForQuickSale handles large customer lists (2500 records) quickly without mutating balances', () => {
  const largeList: Customer[] = Array.from({ length: 2500 }, (_, i) => ({
    id: `cust-${i}`,
    name: i === 1875 ? 'Arjun Target Customer' : `Kirana Grahak ${i}`,
    phone: `98${String(10000000 + i).slice(0, 8)}`,
    openingBalance: 0,
    currentBalance: i * 10,
    totalCreditGiven: i * 10,
    totalPaymentReceived: 0,
    overdueDays: 0,
    category: 'REGULAR',
    createdAt: '2026-01-01T00:00:00Z',
  }));

  const start = performance.now();
  const res = filterCustomersForQuickSale(largeList, 'Target');
  const elapsedMs = performance.now() - start;

  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'cust-1875');
  assert.ok(elapsedMs < 100, `Expected search to finish in <100ms, took ${elapsedMs}ms`);
  assert.equal(largeList[1875].currentBalance, 18750);
});

test('normalizePhoneDigits and calculateProjectedUdharBalance work accurately', () => {
  assert.equal(normalizePhoneDigits('+91 98201-98765'), '919820198765');
  assert.equal(calculateProjectedUdharBalance(3450, 550), 4000);
  assert.equal(calculateProjectedUdharBalance(0, 250.5), 250.5);
  assert.equal(calculateProjectedUdharBalance(-100, 250), 150);
});
