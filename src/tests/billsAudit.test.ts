import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpenseAuditReport,
  buildPurchaseAuditReport,
  buildSaleAuditReport,
} from '../utils/billsAudit';
import type { ExpenseRecord, SaleRecord, Supplier, SupplierTransaction } from '../types';

test('buildSaleAuditReport distinguishes VERIFIED, NEEDS_REVIEW, and CANCELLED bills accurately', () => {
  const sales: SaleRecord[] = [
    {
      id: 's1',
      invoiceNo: 'INV-101',
      date: '2026-11-17T10:00:00+05:30',
      customerName: 'Ramesh',
      amount: 500,
      paymentMethod: 'CASH',
      isCredit: false,
      status: 'COMPLETED',
      createdAt: '2026-11-17T10:00:00+05:30',
      items: [
        {
          productId: 'p1',
          productName: 'Rice',
          quantity: 2,
          unit: 'kg',
          baseUnit: 'kg',
          baseQuantity: 2,
          unitCostAtSale: 45,
          rate: 60,
          total: 120,
        },
      ],
    },
    {
      id: 's2',
      invoiceNo: 'INV-102',
      date: '2026-11-17T11:00:00+05:30',
      customerName: 'Suresh',
      amount: 300,
      paymentMethod: 'CREDIT',
      isCredit: true,
      status: 'COMPLETED',
      createdAt: '2026-11-17T11:00:00+05:30',
      items: [
        {
          productId: 'p2',
          productName: 'Sugar',
          quantity: 1,
          unit: 'kg',
          rate: 45,
          total: 45,
        },
      ],
    },
    {
      id: 's3',
      invoiceNo: 'INV-103',
      date: '2026-11-17T12:00:00+05:30',
      amount: 999,
      paymentMethod: 'UPI',
      isCredit: false,
      status: 'CANCELLED',
      cancelReason: 'Wrong entry',
      createdAt: '2026-11-17T12:00:00+05:30',
      items: [],
    },
  ];

  const report = buildSaleAuditReport({
    sales,
    profile: { gstin: '27ABCDE1234F1Z5' },
  });

  assert.equal(report.totalBills, 3);
  assert.equal(report.activeBills, 2);
  assert.equal(report.cancelledBills, 1);
  assert.equal(report.verifiedBills, 1);
  assert.equal(report.needsReviewBills, 1);
  assert.equal(report.totalRevenue, 800);
  assert.equal(report.paidRevenue, 500);
  assert.equal(report.creditRevenue, 300);
  assert.equal(report.rows[0].auditStatus, 'CANCELLED');
  assert.equal(report.rows[1].auditStatus, 'NEEDS_REVIEW');
  assert.equal(report.rows[2].billingMode, 'GST');
});

test('buildPurchaseAuditReport tracks stock-linked vs ledger-only bills and payable dues', () => {
  const suppliers: Supplier[] = [
    {
      id: 'sup1',
      name: 'Mahavir Wholesale',
      phone: '9876543210',
      gstin: '27XYZAB1234C1Z1',
      openingBalance: 0,
      currentBalance: 1400,
      totalPurchases: 2000,
      totalPaid: 600,
      createdAt: '2026-11-17T09:00:00+05:30',
    },
  ];

  const txs: SupplierTransaction[] = [
    {
      id: 'pt1',
      supplierId: 'sup1',
      type: 'PURCHASE',
      amount: 2000,
      paidAmount: 600,
      paymentStatus: 'PARTIAL',
      paymentMethod: 'BANK',
      invoiceNo: 'BLJ-11',
      description: 'Atta bags',
      productId: 'p1',
      quantity: 10,
      unit: 'bag',
      date: '2026-11-17T10:00:00+05:30',
      status: 'COMPLETED',
      createdAt: '2026-11-17T10:00:00+05:30',
    },
    {
      id: 'pt2',
      supplierId: 'sup1',
      type: 'PURCHASE',
      amount: 500,
      paymentStatus: 'UNPAID',
      description: 'Misc supplies',
      date: '2026-11-17T11:00:00+05:30',
      status: 'COMPLETED',
      createdAt: '2026-11-17T11:00:00+05:30',
    },
  ];

  const report = buildPurchaseAuditReport({
    supplierTransactions: txs,
    suppliers,
  });

  assert.equal(report.activeBills, 2);
  assert.equal(report.stockLinkedBills, 1);
  assert.equal(report.ledgerOnlyBills, 1);
  assert.equal(report.grossPurchaseAmount, 2500);
  assert.equal(report.paidAmount, 600);
  assert.equal(report.payableDueAmount, 1900);
  assert.equal(report.rows[0].auditStatus, 'LEDGER_ONLY');
  assert.equal(report.rows[1].auditStatus, 'STOCK_LINKED');
});

test('buildExpenseAuditReport separates operating expenses from personal drawings', () => {
  const expenses: ExpenseRecord[] = [
    {
      id: 'e1',
      title: 'Electricity Bill',
      category: 'ELECTRICITY',
      amount: 850,
      isPersonalWithdrawal: false,
      paymentMethod: 'UPI',
      date: '2026-11-17T10:00:00+05:30',
      createdAt: '2026-11-17T10:00:00+05:30',
    },
    {
      id: 'e2',
      title: 'Home Drawing',
      category: 'PERSONAL_DRAWING',
      amount: 500,
      isPersonalWithdrawal: true,
      paymentMethod: 'CASH',
      date: '2026-11-17T11:00:00+05:30',
      createdAt: '2026-11-17T11:00:00+05:30',
    },
  ];

  const report = buildExpenseAuditReport({ expenses });
  assert.equal(report.totalEntries, 2);
  assert.equal(report.operatingAmount, 850);
  assert.equal(report.drawingsAmount, 500);
  assert.equal(report.cashOutAmount, 500);
  assert.equal(report.digitalOutAmount, 850);
});
