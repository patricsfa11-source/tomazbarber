export type PaymentMethod = 'pix' | 'cash' | 'card';
export const paymentMethods: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  card: 'Cartão',
};
export function parseMoney(value: string): number | null {
  const match = value.trim().match(/^(\d{1,6})(?:[,.](\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 && cents <= 99999999 ? cents : null;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const moneyInput = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
export function suggestedAmount(label: string, method: PaymentMethod): number | null {
  const prices = [...label.matchAll(/R\$\s*([\d.]+,\d{2})([^·]*)/g)];
  const selected =
    prices.find((p) => (method === 'card' ? /cartão/i.test(p[2]) : /pix|dinheiro/i.test(p[2]))) ||
    prices[0];
  return selected ? parseMoney(selected[1].replaceAll('.', '')) : null;
}
export interface ReceiptRecord {
  id: string;
  appointment_id: string;
  customer_id: string;
  customer_name: string;
  service_id: string;
  service_name: string;
  amount_cents: number;
  paid_on: string;
  method: PaymentMethod;
  created_at: number;
}
export interface ReceiptGroup {
  id: string;
  name: string;
  total_cents: number;
  count: number;
}
export interface ReceiptReport {
  today: string;
  from: string;
  to: string;
  today_cents: number;
  month_cents: number;
  total_cents: number;
  count: number;
  clients: ReceiptGroup[];
  services: ReceiptGroup[];
  methods: ReceiptGroup[];
  receipts: ReceiptRecord[];
  nextCursor: string | null;
}
