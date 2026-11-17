// Volume correction to standard litres at 15 °C.
// Linear approximation of ASTM D1250 / ISO 91 Table 54B: VCF = 1 - alpha * (T - 15).
// Gases (LPG, LNG) are carried and billed by mass (kg), so no correction applies.

export function vcf(product, tempC) {
  if (!product || product.unit !== 'L' || tempC === null || tempC === undefined || tempC === '') return 1;
  return 1 - product.vcfAlpha * (Number(tempC) - 15);
}

export function toStd15(product, observed, tempC) {
  return Math.round(Number(observed || 0) * vcf(product, tempC));
}

export const devPct = (actual, planned) => (planned ? (actual - planned) / planned : 0);
