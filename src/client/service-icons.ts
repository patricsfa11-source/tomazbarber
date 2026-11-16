const scissors =
  '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 11 11M14.3 9.7 19.2 4.8M8.2 15.8l3.8-3.8"/>';
const beard =
  '<path d="M4 9v4.5c0 3.6 3.7 7 8 8 4.3-1 8-4.4 8-8V9c-1 2-2.5 3.3-4.4 3.6a5.4 5.4 0 0 0-7.2 0C6.5 12.3 5 11 4 9Z"/><path d="M6 7.5c2.7.6 3.9-2.6 6-.7 2.1-1.9 3.3 1.3 6 .7M10.5 16h3"/>';
const clipper =
  '<path d="M6 5h12v4H6zM8 3v2m4-2v2m4-2v2M8 9v8l2 4h4l2-4V9m-4 4v3"/>';

const icons = new Map([
  ['corte', scissors],
  ['barba', beard],
  [
    'corte-barba',
    `<g transform="scale(.65)">${scissors}</g><g transform="translate(9 9) scale(.65)">${beard}</g>`,
  ],
  ['pe', clipper],
  [
    'pe-barba',
    `<g transform="translate(-1 0) scale(.65)">${clipper}</g><g transform="translate(9 9) scale(.65)">${beard}</g>`,
  ],
  [
    'pigmentacao',
    '<path d="m5 3 10 3-2 7-4-1-2 8a1.4 1.4 0 0 1-2.7-.7l2-8-3-.9L5 3Zm-.8 4.2 9.7 2.9M19 7c-1.5 2.1-2.4 3.3-2.4 4.5a2.4 2.4 0 0 0 4.8 0C21.4 10.3 20.5 9.1 19 7Z"/>',
  ],
  [
    'luzes',
    '<path d="M10 4c.6 4.1 2.4 5.8 6.5 6.5-4.1.7-5.9 2.4-6.5 6.5-.7-4.1-2.4-5.8-6.5-6.5C7.6 9.8 9.3 8.1 10 4ZM19 13v6m-3-3h6M18 4v4m-2-2h4"/>',
  ],
  [
    'escova',
    '<path d="M14 4a3.5 3.5 0 0 1 5 5l-6 6a3 3 0 0 1-3.5.5l-4.4 4.4-1.5-1.5L8 14a3 3 0 0 1 .5-3.5L14 4Zm-2 3 4 4m-6-2 4 4m0-8 4 4"/>',
  ],
]);
const fallback =
  '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3.5v3m8-3v3M4 10h16m-10 5h4"/>';

export function serviceIcon(serviceId: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" focusable="false">${icons.get(serviceId) ?? fallback}</svg>`;
}
