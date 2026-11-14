export interface Pause {
  startsAt: number;
  endsAt: number;
}
export interface Weekday {
  weekday: number;
  enabled: boolean;
  opensAt: number;
  closesAt: number;
  breaks: Pause[];
}
export interface SpecialHours {
  id: number;
  from: string;
  to: string;
  closed: boolean;
  opensAt: number;
  closesAt: number;
  breaks: Pause[];
}
export interface AvailabilityRule extends Pause {
  id: number;
  from: string;
  to: string;
  scope: 'online' | 'all';
}
export interface ScheduleConfig {
  revision: number;
  agendaRevision: number;
  days: Weekday[];
  specials: SpecialHours[];
  rules: AvailabilityRule[];
}
export type ScheduleCommand =
  | { kind: 'weekly'; days: Weekday[] }
  | ({ kind: 'special' } & Omit<SpecialHours, 'id'>)
  | ({ kind: 'rule' } & Omit<AvailabilityRule, 'id'>)
  | { kind: 'remove-special' | 'remove-rule'; id: number };
export interface AppointmentRecord {
  id: string;
  shop_id: string;
  professional_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  price_label: string;
  duration_minutes: number;
  starts_at: number;
  ends_at: number;
  origin: 'link' | 'hub';
  booking_channel: 'link' | 'hub';
  status: 'confirmed' | 'cancelled';
  version: number;
  cancelled_at: number | null;
}
export interface BookingEvent {
  id: number;
  version: number;
  kind: 'created' | 'rescheduled' | 'cancelled';
  old_start: number | null;
  old_end: number | null;
  new_start: number;
  new_end: number;
  created_at: number;
}
export interface AppointmentDetail {
  appointment: AppointmentRecord;
  events: BookingEvent[];
  reminder: {
    state: 'scheduled' | 'suppressed' | 'cancelled';
    due_at: number | null;
    booking_version: number;
  } | null;
}
export interface AffectedBooking {
  id: string;
  customer_name: string;
  service_name: string;
  starts_at: number;
  ends_at: number;
  version: number;
  booking_channel: 'link' | 'hub';
}
export interface ScheduleView extends ScheduleConfig {
  affected: AffectedBooking[];
}
export interface SchedulePreview {
  command: ScheduleCommand;
  revision: number;
  agendaRevision: number;
  affected: AffectedBooking[];
  previewToken: string;
}
