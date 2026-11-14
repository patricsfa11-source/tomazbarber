export interface CustomerBooking {
  id: string;
  service: string;
  price: string;
  duration: number;
  startsAt: number;
  endsAt: number;
  status: 'confirmed' | 'cancelled';
  version: number;
  canReschedule: boolean;
  canCancel: boolean;
}
export interface CustomerBookings {
  appointments: CustomerBooking[];
  nextCursor: string | null;
}
export const cancellationNotice = 'Cancelamento sem custo com pelo menos 2 horas de antecedência.';
export const lateChangeNotice =
  'Faltam menos de 2 horas para o atendimento. Combine a alteração diretamente com o salão. Sua reserva continua confirmada.';
