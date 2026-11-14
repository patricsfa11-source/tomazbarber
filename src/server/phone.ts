import { ApiError } from './errors';
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 30)
    throw new ApiError(400, 'Informe um celular brasileiro com DDD.');
  let phone = value.replace(/\D/g, '');
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55'))
    phone = phone.slice(2);
  if (!/^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(phone))
    throw new ApiError(400, 'Informe um telefone brasileiro com DDD.');
  return `+55${phone}`;
}
