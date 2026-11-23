import { Customer, SaleRecord, StoreProfile } from '../types';
import { formatINR } from './accounting';

/**
 * Normalizes a customer phone number for WhatsApp API links (adds 91 prefix for 10-digit Indian numbers).
 */
export function normalizeIndianPhoneForWhatsApp(phone?: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

/**
 * Formats a clean, shop-ready WhatsApp receipt message for any sale bill.
 */
export function formatSaleReceiptWhatsAppText(
  sale: SaleRecord,
  profile: StoreProfile,
  customer?: Customer
): string {
  const storeName = profile.storeName || 'Arjun Groceries';
  const dateObj = new Date(sale.date || sale.createdAt);
  const formattedDate = isNaN(dateObj.getTime())
    ? sale.date
    : dateObj.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

  const customerLabel = sale.customerName || customer?.name || 'Valued Customer';
  const modeLabel =
    sale.paymentMethod === 'CREDIT' || sale.isCredit
      ? 'UDHAR (Pending Credit)'
      : sale.paymentMethod === 'UPI'
      ? 'PAID via UPI / QR'
      : 'PAID in CASH';

  const lines: string[] = [
    `*${storeName}*`,
    profile.phone ? `Mob: ${profile.phone}` : '',
    `--------------------------------`,
    `*Digital Bill Receipt*`,
    `Bill No: *#${sale.invoiceNo}*`,
    `Date: ${formattedDate}`,
    `Customer: ${customerLabel}`,
    `--------------------------------`,
  ].filter(Boolean);

  if (sale.items && sale.items.length > 0) {
    lines.push(`*Items Purchased:*`);
    sale.items.forEach((it, idx) => {
      const unitLabel = it.unit ? ` ${it.unit}` : '';
      lines.push(`${idx + 1}. ${it.productName} (${it.quantity}${unitLabel}) - ${formatINR(it.total)}`);
    });
    lines.push(`--------------------------------`);
  } else if (sale.notes) {
    lines.push(`Details: ${sale.notes}`);
    lines.push(`--------------------------------`);
  }

  lines.push(`*GRAND TOTAL: ${formatINR(sale.amount)}*`);
  lines.push(`Payment Status: ${modeLabel}`);

  if ((sale.paymentMethod === 'CREDIT' || sale.isCredit) && profile.upiId) {
    lines.push(`Pay via UPI: ${profile.upiId}`);
  }

  if (customer && customer.currentBalance > 0) {
    lines.push(`Current Total Khata Balance: ${formatINR(customer.currentBalance)}`);
  }

  lines.push(``);
  lines.push(`Dhanyawad! Visit again at ${storeName}.`);

  return lines.join('\n');
}

/**
 * Builds the WhatsApp Web / App send link with pre-filled receipt message.
 */
export function buildWhatsAppShareUrl(phone: string | undefined, message: string): string {
  const normalizedPhone = normalizeIndianPhoneForWhatsApp(phone);
  const encodedText = encodeURIComponent(message);
  if (normalizedPhone.length >= 10) {
    return `https://api.whatsapp.com/send?phone=${normalizedPhone}&text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}

/**
 * Renders a crisp high-resolution PNG receipt image in the browser for sharing or downloading.
 */
export function renderSaleReceiptCanvasDataUrl(
  sale: SaleRecord,
  profile: StoreProfile,
  customer?: Customer
): string | null {
  if (typeof document === 'undefined') return null;

  const items = sale.items && sale.items.length > 0 ? sale.items : [];
  const rowCount = Math.max(1, items.length);
  const width = 560;
  const height = 430 + rowCount * 30;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Background paper
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Outer frame
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // Emerald Header Banner
  ctx.fillStyle = '#064e3b';
  ctx.fillRect(12, 12, width - 24, 100);

  const fitTextToWidth = (text: string, maxW: number): string => {
    if (ctx.measureText(text).width <= maxW) return text;
    let clipped = text;
    while (clipped.length > 3 && ctx.measureText(`${clipped}…`).width > maxW) {
      clipped = clipped.slice(0, -1);
    }
    return `${clipped.trimEnd()}…`;
  };

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    fitTextToWidth(profile.storeName || 'Arjun Groceries', width - 56),
    width / 2,
    50
  );

  ctx.fillStyle = '#d1fae5';
  ctx.font = '12px sans-serif';
  ctx.fillText(
    fitTextToWidth(profile.address || 'Fresh Daily Groceries & Staples', width - 52),
    width / 2,
    74
  );
  ctx.fillText(
    fitTextToWidth(`Mob: ${profile.phone || ''}  |  UPI: ${profile.upiId || 'Store Counter'}`, width - 52),
    width / 2,
    95
  );

  // Meta Section
  let y = 142;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`DIGITAL BILL RECEIPT  #${sale.invoiceNo}`, 28, y);

  y += 26;
  ctx.fillStyle = '#475569';
  ctx.font = '13px sans-serif';
  const dateFormatted = new Date(sale.date || sale.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  ctx.fillText(`Date: ${dateFormatted}`, 28, y);

  ctx.textAlign = 'right';
  const modeText =
    sale.paymentMethod === 'CREDIT' || sale.isCredit ? 'MODE: UDHAR CREDIT' : `MODE: ${sale.paymentMethod}`;
  ctx.fillStyle = sale.paymentMethod === 'CREDIT' || sale.isCredit ? '#b91c1c' : '#047857';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText(modeText, width - 28, y);

  y += 22;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#334155';
  ctx.font = '13px sans-serif';
  ctx.fillText(`Customer: ${sale.customerName || customer?.name || 'Walk-in Customer'}`, 28, y);

  // Dashed divider
  y += 18;
  ctx.strokeStyle = '#94a3b8';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(width - 28, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Table Headers
  y += 24;
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('ITEM', 28, y);
  ctx.textAlign = 'right';
  ctx.fillText('QTY', 360, y);
  ctx.fillText('AMOUNT', width - 28, y);

  // Items
  y += 22;
  ctx.fillStyle = '#0f172a';
  ctx.font = '14px sans-serif';
  if (items.length > 0) {
    items.forEach((it) => {
      ctx.textAlign = 'left';
      const label = it.productName.length > 28 ? `${it.productName.slice(0, 27)}…` : it.productName;
      ctx.fillText(label, 28, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${it.quantity} ${it.unit || ''}`.trim(), 360, y);
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(formatINR(it.total), width - 28, y);
      ctx.font = '14px sans-serif';
      y += 28;
    });
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(sale.notes || 'Counter Grocery Ration', 28, y);
    ctx.textAlign = 'right';
    ctx.fillText('1 lot', 360, y);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(formatINR(sale.amount), width - 28, y);
    y += 28;
  }

  // Total Box
  y += 10;
  ctx.fillStyle = '#ecfdf5';
  ctx.fillRect(28, y, width - 56, 52);
  ctx.strokeStyle = '#a7f3d0';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(28, y, width - 56, 52);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#065f46';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('GRAND TOTAL', 44, y + 32);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#064e3b';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(formatINR(sale.amount), width - 44, y + 34);

  // Footer
  y += 82;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText('Thank you for shopping with us! Visit again.', width / 2, y);

  return canvas.toDataURL('image/png');
}
