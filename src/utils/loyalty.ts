import { Customer, LoyaltyProgramConfig, SaleRecord, StoreProfile } from '../types';
import { isSaleActive } from './accounting';

export const DEFAULT_LOYALTY_CONFIG: LoyaltyProgramConfig = {
  enabled: true,
  pointsPer100Rupees: 5, // 5 points per ₹100 net bill (1 point per ₹20 spent)
  rupeeValuePerPoint: 1, // 1 point = ₹1 discount on future purchases
  minRedeemPoints: 10, // Minimum 10 points to redeem
  maxDiscountPercent: 50, // Max 50% of bill can be paid using loyalty points
};

export function normalizeLoyaltyConfig(
  raw?: Partial<LoyaltyProgramConfig> | null
): LoyaltyProgramConfig {
  const base = DEFAULT_LOYALTY_CONFIG;
  const pointsPer100 = Number(raw?.pointsPer100Rupees);
  const rupeePerPoint = Number(raw?.rupeeValuePerPoint);
  const minRedeem = Number(raw?.minRedeemPoints);
  const maxPct = Number(raw?.maxDiscountPercent);

  return {
    enabled: raw?.enabled !== undefined ? Boolean(raw.enabled) : base.enabled,
    pointsPer100Rupees:
      Number.isFinite(pointsPer100) && pointsPer100 >= 0 && pointsPer100 <= 100
        ? Math.round(pointsPer100 * 100) / 100
        : base.pointsPer100Rupees,
    rupeeValuePerPoint:
      Number.isFinite(rupeePerPoint) && rupeePerPoint > 0 && rupeePerPoint <= 100
        ? Math.round(rupeePerPoint * 100) / 100
        : base.rupeeValuePerPoint,
    minRedeemPoints:
      Number.isFinite(minRedeem) && minRedeem >= 0 && minRedeem <= 10000
        ? Math.floor(minRedeem)
        : base.minRedeemPoints,
    maxDiscountPercent:
      Number.isFinite(maxPct) && maxPct >= 1 && maxPct <= 100
        ? Math.round(maxPct)
        : base.maxDiscountPercent,
    updatedAt: raw?.updatedAt,
  };
}

export function resolveLoyaltyConfig(profile?: StoreProfile | null): LoyaltyProgramConfig {
  return normalizeLoyaltyConfig(profile?.loyaltyConfig);
}

/**
 * Calculates whole loyalty points earned on the net bill amount paid.
 */
export function calculatePointsEarned(
  netBillAmount: number,
  config: LoyaltyProgramConfig
): number {
  if (!config.enabled) return 0;
  const amount = Number(netBillAmount);
  if (!Number.isFinite(amount) || amount <= 0 || config.pointsPer100Rupees <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((amount / 100) * config.pointsPer100Rupees));
}

export interface LoyaltyRedemptionCalculation {
  valid: boolean;
  error?: string;
  pointsToRedeem: number;
  discountAmount: number;
  netPayableAmount: number;
  maxRedeemablePoints: number;
  maxDiscountAmount: number;
}

/**
 * Validates and computes loyalty point redemption against a bill's gross amount.
 */
export function calculateLoyaltyRedemption(params: {
  availablePoints: number;
  requestedPoints: number;
  grossBillAmount: number;
  config: LoyaltyProgramConfig;
}): LoyaltyRedemptionCalculation {
  const gross = Math.max(0, Math.round((Number(params.grossBillAmount) || 0) * 100) / 100);
  const available = Math.max(0, Math.floor(Number(params.availablePoints) || 0));
  const requested = Math.floor(Number(params.requestedPoints) || 0);
  const cfg = normalizeLoyaltyConfig(params.config);

  const maxAllowedDiscountByPct =
    Math.round(((gross * cfg.maxDiscountPercent) / 100) * 100) / 100;
  // Keep at least ₹1 payable if bill is >= ₹1 so accounting sale amount stays strictly positive
  const maxSafeDiscount = gross > 1 ? Math.min(maxAllowedDiscountByPct, gross - 1) : 0;
  const maxPointsByCap =
    cfg.rupeeValuePerPoint > 0 ? Math.floor(maxSafeDiscount / cfg.rupeeValuePerPoint) : 0;
  const maxRedeemablePoints = Math.max(0, Math.min(available, maxPointsByCap));
  const maxDiscountAmount =
    Math.round(maxRedeemablePoints * cfg.rupeeValuePerPoint * 100) / 100;

  if (requested <= 0) {
    return {
      valid: true,
      pointsToRedeem: 0,
      discountAmount: 0,
      netPayableAmount: gross,
      maxRedeemablePoints,
      maxDiscountAmount,
    };
  }

  if (!cfg.enabled) {
    return {
      valid: false,
      error: 'Loyalty points program is currently paused in Store Settings.',
      pointsToRedeem: 0,
      discountAmount: 0,
      netPayableAmount: gross,
      maxRedeemablePoints: 0,
      maxDiscountAmount: 0,
    };
  }

  if (requested < cfg.minRedeemPoints) {
    return {
      valid: false,
      error: `Minimum ${cfg.minRedeemPoints} points required to redeem on a bill.`,
      pointsToRedeem: 0,
      discountAmount: 0,
      netPayableAmount: gross,
      maxRedeemablePoints,
      maxDiscountAmount,
    };
  }

  if (requested > available) {
    return {
      valid: false,
      error: `Customer only has ${available} available loyalty points.`,
      pointsToRedeem: 0,
      discountAmount: 0,
      netPayableAmount: gross,
      maxRedeemablePoints,
      maxDiscountAmount,
    };
  }

  if (requested > maxRedeemablePoints) {
    return {
      valid: false,
      error: `Up to ${maxRedeemablePoints} points (₹${maxDiscountAmount}) can be redeemed on this ₹${gross} bill (${cfg.maxDiscountPercent}% cap).`,
      pointsToRedeem: 0,
      discountAmount: 0,
      netPayableAmount: gross,
      maxRedeemablePoints,
      maxDiscountAmount,
    };
  }

  const discountAmount = Math.round(requested * cfg.rupeeValuePerPoint * 100) / 100;
  const netPayableAmount = Math.round(Math.max(1, gross - discountAmount) * 100) / 100;

  return {
    valid: true,
    pointsToRedeem: requested,
    discountAmount,
    netPayableAmount,
    maxRedeemablePoints,
    maxDiscountAmount,
  };
}

export interface LoyaltyActivityEntry {
  saleId: string;
  invoiceNo: string;
  date: string;
  grossAmount: number;
  netAmount: number;
  pointsEarned: number;
  pointsRedeemed: number;
  discountAmount: number;
  netPointsDelta: number;
  runningBalance: number;
  paymentMethod: SaleRecord['paymentMethod'];
}

export interface CustomerLoyaltyLedger {
  customerId: string;
  customerName: string;
  phone: string;
  totalEarned: number;
  totalRedeemed: number;
  availablePoints: number;
  redeemableValueRs: number;
  totalDiscountSaved: number;
  totalSpend: number;
  eligibleSalesCount: number;
  lastActivityDate?: string;
  status: 'REDEEM_READY' | 'EARNING' | 'NEW';
  entries: LoyaltyActivityEntry[];
}

export function buildCustomerLoyaltyLedger(
  customer: Customer,
  sales: SaleRecord[],
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_CONFIG
): CustomerLoyaltyLedger {
  const cfg = normalizeLoyaltyConfig(config);
  const custSales = sales
    .filter((s) => s.customerId === customer.id && isSaleActive(s))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let running = 0;
  let totalEarned = 0;
  let totalRedeemed = 0;
  let totalDiscountSaved = 0;
  let totalSpend = 0;
  const entries: LoyaltyActivityEntry[] = [];

  for (const sale of custSales) {
    const earned = Math.max(0, Math.floor(Number(sale.loyaltyPointsEarned) || 0));
    const redeemed = Math.max(0, Math.floor(Number(sale.loyaltyPointsRedeemed) || 0));
    const discount = Math.max(0, Math.round((Number(sale.loyaltyDiscountAmount) || 0) * 100) / 100);
    const netAmt = Math.max(0, Math.round((Number(sale.amount) || 0) * 100) / 100);
    const grossAmt =
      sale.grossAmount !== undefined && Number.isFinite(Number(sale.grossAmount))
        ? Math.round(Number(sale.grossAmount) * 100) / 100
        : Math.round((netAmt + discount) * 100) / 100;

    totalSpend = Math.round((totalSpend + netAmt) * 100) / 100;

    if (earned > 0 || redeemed > 0 || discount > 0) {
      totalEarned += earned;
      totalRedeemed += redeemed;
      totalDiscountSaved = Math.round((totalDiscountSaved + discount) * 100) / 100;
      const delta = earned - redeemed;
      running = Math.max(0, running + delta);
      entries.push({
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        date: sale.date,
        grossAmount: grossAmt,
        netAmount: netAmt,
        pointsEarned: earned,
        pointsRedeemed: redeemed,
        discountAmount: discount,
        netPointsDelta: delta,
        runningBalance: running,
        paymentMethod: sale.paymentMethod,
      });
    }
  }

  const availablePoints = Math.max(0, totalEarned - totalRedeemed);
  const redeemableValueRs =
    Math.round(availablePoints * cfg.rupeeValuePerPoint * 100) / 100;
  const status: CustomerLoyaltyLedger['status'] =
    availablePoints >= cfg.minRedeemPoints && availablePoints > 0
      ? 'REDEEM_READY'
      : totalEarned > 0
      ? 'EARNING'
      : 'NEW';

  return {
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone,
    totalEarned,
    totalRedeemed,
    availablePoints,
    redeemableValueRs,
    totalDiscountSaved,
    totalSpend,
    eligibleSalesCount: custSales.length,
    lastActivityDate:
      entries.length > 0 ? entries[entries.length - 1].date : customer.lastTransactionDate,
    status,
    entries: entries.reverse(),
  };
}

export interface StoreLoyaltySummary {
  totalMembersCount: number;
  activeEarnersCount: number;
  redeemReadyCount: number;
  totalPointsEarned: number;
  totalPointsRedeemed: number;
  totalAvailablePoints: number;
  totalLiabilityRs: number;
  totalDiscountsGivenRs: number;
  customerRows: CustomerLoyaltyLedger[];
}

export function buildStoreLoyaltySummary(
  customers: Customer[],
  sales: SaleRecord[],
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_CONFIG
): StoreLoyaltySummary {
  const rows = customers
    .map((c) => buildCustomerLoyaltyLedger(c, sales, config))
    .sort((a, b) => {
      if (b.availablePoints !== a.availablePoints) return b.availablePoints - a.availablePoints;
      if (b.totalEarned !== a.totalEarned) return b.totalEarned - a.totalEarned;
      return a.customerName.localeCompare(b.customerName);
    });

  let activeEarnersCount = 0;
  let redeemReadyCount = 0;
  let totalPointsEarned = 0;
  let totalPointsRedeemed = 0;
  let totalAvailablePoints = 0;
  let totalLiabilityRs = 0;
  let totalDiscountsGivenRs = 0;

  for (const row of rows) {
    if (row.totalEarned > 0) activeEarnersCount += 1;
    if (row.status === 'REDEEM_READY') redeemReadyCount += 1;
    totalPointsEarned += row.totalEarned;
    totalPointsRedeemed += row.totalRedeemed;
    totalAvailablePoints += row.availablePoints;
    totalLiabilityRs = Math.round((totalLiabilityRs + row.redeemableValueRs) * 100) / 100;
    totalDiscountsGivenRs =
      Math.round((totalDiscountsGivenRs + row.totalDiscountSaved) * 100) / 100;
  }

  return {
    totalMembersCount: customers.length,
    activeEarnersCount,
    redeemReadyCount,
    totalPointsEarned,
    totalPointsRedeemed,
    totalAvailablePoints,
    totalLiabilityRs,
    totalDiscountsGivenRs,
    customerRows: rows,
  };
}
