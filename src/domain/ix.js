// Fast lookups over master data. Cached per masters object (immer gives a new object on change).
const cache = new WeakMap();

export function ixOf(masters) {
  if (cache.has(masters)) return cache.get(masters);
  const map = (arr = []) => new Map(arr.map((x) => [x.id, x]));
  const m = {
    loc: map(masters.locations),
    product: map(masters.products),
    truck: map(masters.trucks),
    trailer: map(masters.trailers),
    driver: map(masters.drivers),
    customer: map(masters.customers),
    contract: map(masters.contracts),
    rateCard: map(masters.rateCards),
    company: map(masters.companies),
    user: map(masters.users),
  };
  const ix = {
    masters,
    loc: (id) => m.loc.get(id),
    product: (id) => m.product.get(id),
    truck: (id) => m.truck.get(id),
    trailer: (id) => m.trailer.get(id),
    driver: (id) => m.driver.get(id),
    customer: (id) => m.customer.get(id),
    contract: (id) => m.contract.get(id),
    rateCard: (id) => m.rateCard.get(id),
    company: (id) => m.company.get(id),
    user: (id) => m.user.get(id),
    contractOf: (customerId) => m.contract.get(m.customer.get(customerId)?.contractId),
    rateCardOf: (customerId) => m.rateCard.get(m.contract.get(m.customer.get(customerId)?.contractId)?.rateCardId),
    terminals: () => masters.locations.filter((l) => l.kind === 'terminal'),
    sitesOf: (customerId) => masters.locations.filter((l) => l.kind === 'site' && l.customerId === customerId),
  };
  cache.set(masters, ix);
  return ix;
}
