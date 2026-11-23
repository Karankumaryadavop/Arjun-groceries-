import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseRecord } from '../types';
import { calculateMonthlyOperatingExpensesChart } from './expenseAnalytics';

test('calculateMonthlyOperatingExpensesChart aggregates last 6 months and excludes personal drawings', () => {
  const refDate = new Date('2026-11-14T10:00:00Z');
  const expenses: ExpenseRecord[] = [
    {
      id: 'e1',
      title: 'June Rent',
      category: 'SHOP',
      amount: 8000,
      isPersonalWithdrawal: false,
      paymentMethod: 'BANK',
      date: '2026-06-05',
      createdAt: '2026-06-05T10:00:00Z',
    },
    {
      id: 'e2',
      title: 'Oct Electricity',
      category: 'ELECTRICITY',
      amount: 2400,
      isPersonalWithdrawal: false,
      paymentMethod: 'UPI',
      date: '2026-10-12',
      createdAt: '2026-10-12T10:00:00Z',
    },
    {
      id: 'e3',
      title: 'Nov Staff Salary',
      category: 'STAFF',
      amount: 3600,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-11-06',
      createdAt: '2026-11-06T10:00:00Z',
    },
    {
      id: 'e4',
      title: 'Nov Personal Home Withdrawal',
      category: 'PERSONAL_DRAWING',
      amount: 5000,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-08',
      createdAt: '2026-11-08T10:00:00Z',
    },
    {
      id: 'e5',
      title: 'Out of window May Expense',
      category: 'SHOP',
      amount: 9999,
      isPersonalWithdrawal: false,
      paymentMethod: 'CASH',
      date: '2026-05-01',
      createdAt: '2026-05-01T10:00:00Z',
    },
  ];

  const summary = calculateMonthlyOperatingExpensesChart(expenses, refDate, 6);
  assert.equal(summary.monthlyData.length, 6);
  assert.deepEqual(
    summary.monthlyData.map((m) => m.monthKey),
    ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
  );

  // Total operating excludes Personal Drawing (5000) and May out-of-window (9999)
  assert.equal(summary.sixMonthOperatingTotal, 14000);
  assert.equal(summary.sixMonthDrawingsTotal, 5000);
  assert.equal(summary.peakMonth.monthKey, '2026-06');
  assert.equal(summary.peakMonth.operatingTotal, 8000);
  assert.equal(summary.currentMonthTotal, 3600);
  assert.equal(summary.previousMonthTotal, 2400);
  assert.equal(summary.momChangePct, 50);
});

test('calculateMonthlyOperatingExpensesChart handles empty expense lists cleanly', () => {
  const summary = calculateMonthlyOperatingExpensesChart([], new Date('2026-11-14T10:00:00Z'), 6);
  assert.equal(summary.monthlyData.length, 6);
  assert.equal(summary.sixMonthOperatingTotal, 0);
  assert.equal(summary.averageMonthlyOperating, 0);
  assert.equal(summary.momChangePct, 0);
});
