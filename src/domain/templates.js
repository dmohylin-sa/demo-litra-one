// Customer notification templates per event and language (editable in Administration).
export const DEFAULT_TEMPLATES = [
  { event: 'ORDER_CONFIRMED', lang: 'nb', body: 'Litra: Bestilling {order} er bekreftet. Levering til {site} {date} kl. {from}-{to}.' },
  { event: 'ORDER_CONFIRMED', lang: 'en', body: 'Litra: Order {order} is confirmed. Delivery to {site} on {date}, {from}-{to}.' },
  { event: 'ORDER_CONFIRMED', lang: 'sv', body: 'Litra: Order {order} är bekräftad. Leverans till {site} {date} kl. {from}-{to}.' },
  { event: 'ON_THE_WAY', lang: 'nb', body: 'Litra: Bilen er på vei til {site}. Forventet ankomst kl. {eta}.' },
  { event: 'ON_THE_WAY', lang: 'en', body: 'Litra: Your delivery to {site} is on the way. ETA {eta}.' },
  { event: 'ON_THE_WAY', lang: 'sv', body: 'Litra: Leveransen till {site} är på väg. Beräknad ankomst kl. {eta}.' },
  { event: 'DELAY', lang: 'nb', body: 'Litra: Forsinkelse til {site}. Ny forventet ankomst kl. {eta}. Årsak: {reason}.' },
  { event: 'DELAY', lang: 'en', body: 'Litra: Delay for {site}. New ETA {eta}. Reason: {reason}.' },
  { event: 'DELAY', lang: 'sv', body: 'Litra: Försening till {site}. Ny beräknad ankomst kl. {eta}. Orsak: {reason}.' },
  { event: 'DELIVERED', lang: 'nb', body: 'Litra: Levert {qty} til {site} kl. {time}. Leveringskvittering (POD) er vedlagt.' },
  { event: 'DELIVERED', lang: 'en', body: 'Litra: Delivered {qty} to {site} at {time}. Proof of delivery attached.' },
  { event: 'DELIVERED', lang: 'sv', body: 'Litra: Levererat {qty} till {site} kl. {time}. Leveranskvitto (POD) bifogas.' },
];

export const EVENT_LABELS = {
  ORDER_CONFIRMED: 'Order confirmed',
  ON_THE_WAY: 'On the way + ETA',
  DELAY: 'Delay',
  DELIVERED: 'Delivered + POD',
  INVOICE: 'Invoice issued',
};

export function render(body, vars) {
  return body.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

export function templateFor(templates, event, lang) {
  return templates.find((t) => t.event === event && t.lang === lang) || templates.find((t) => t.event === event && t.lang === 'en');
}
