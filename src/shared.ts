export interface Service {
  id: string;
  name: string;
  duration: number;
  price: string;
  description: string;
}
export const services: Service[] = [
  {
    id: 'corte',
    name: 'Corte masculino',
    duration: 30,
    price: 'R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão',
    description: 'Seu estilo, no detalhe.',
  },
  {
    id: 'barba',
    name: 'Barba',
    duration: 20,
    price: 'R$ 15,00',
    description: 'Contorno preciso e acabamento.',
  },
  {
    id: 'corte-barba',
    name: 'Corte com barba',
    duration: 40,
    price: 'R$ 38,00',
    description: 'O cuidado completo.',
  },
  {
    id: 'pe',
    name: 'Pé de cabelo',
    duration: 20,
    price: 'R$ 15,00',
    description: 'Acabamento que faz a diferença.',
  },
  {
    id: 'pe-barba',
    name: 'Pé com barba',
    duration: 60,
    price: 'R$ 20,00',
    description: 'Cabelo alinhado, barba em dia.',
  },
  {
    id: 'pigmentacao',
    name: 'Pigmentação',
    duration: 60,
    price: 'R$ 20,00',
    description: 'Mais definição para o seu visual.',
  },
  {
    id: 'luzes',
    name: 'Luzes',
    duration: 60,
    price: 'A partir de R$ 60,00',
    description: 'Um novo toque de personalidade.',
  },
];
export const timezone = 'America/Bahia';
export function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(now);
}
export function addDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T12:00:00-03:00`) + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function timeLabel(seconds: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}
export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00-03:00`));
}
