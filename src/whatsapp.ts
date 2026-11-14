export interface WhatsAppStatus {
  configured: boolean;
  mode: 'off' | 'test';
  testRecipient: string | null;
  deliveries: {
    id: string;
    kind: string;
    appointment_id: string | null;
    state: string;
    attempts: number;
    next_attempt_at: number;
    last_error_code: string | null;
    created_at: number;
    canRetry: boolean;
  }[];
}
