export interface Service {
  id: string;
  name: string;
  duration: number;
  price: string;
  description: string;
}
export interface Shop {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  logoUrl: string | null;
  description: string;
  hours: { weekday: number; opensAt: number; closesAt: number }[];
}
// Catálogo inicial para conferência de migração e testes. A API lê o catálogo do banco.
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
export function localDate(now = new Date(), zone = timezone): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(now);
}
export function addDays(date: string, amount: number): string {
  return new Date(Date.parse(`${date}T12:00:00-03:00`) + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function timeLabel(seconds: number, zone = timezone): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
}
export function dateLabel(date: string, zone = timezone): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(localInstant(date, 720, zone) * 1000));
}

// Converte hora de parede em UTC sem depender do fuso do servidor/navegador.
export function localInstant(date: string, minutes: number, zone = timezone): number {
  const target = Date.parse(`${date}T00:00:00Z`) + minutes * 60000;
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    const wall = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const adjustment = target - wall;
    instant += adjustment;
    if (adjustment === 0) return instant / 1000;
  }
  throw new Error('Horário local inexistente.');
}

export function hoursLabel(shop: Shop): string {
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const rows = [...shop.hours].sort((a, b) => (a.weekday || 7) - (b.weekday || 7));
  const groups: (typeof rows)[] = [];
  for (const row of rows) {
    const previous = groups.at(-1)?.at(-1);
    if (
      previous &&
      (row.weekday || 7) === (previous.weekday || 7) + 1 &&
      previous.opensAt === row.opensAt &&
      previous.closesAt === row.closesAt
    )
      groups.at(-1)!.push(row);
    else groups.push([row]);
  }
  const time = (m: number) =>
    `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
  return groups
    .map(
      (group) =>
        `${days[group[0].weekday]}${group.length > 1 ? ` a ${days[group.at(-1)!.weekday].toLowerCase()}` : ''} · ${time(group[0].opensAt)} às ${time(group[0].closesAt)}`,
    )
    .join(' / ');
}
