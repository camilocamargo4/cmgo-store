/**
 * Cmgo price estimate: the one place prices live.
 *
 * Garment price = AS Colour trade cost (CMGO account, Nov 2026) + MARKUP.
 * Each print adds a fixed price by where it goes on the garment.
 * The customiser shows the result as an estimate; the final price is confirmed on review.
 */
export const PRICING = {
  currency: 'AUD',
  markup: 0.40,                    // 40% on the garment cost

  // Price per print, by print area. Areas not listed use `default`.
  prints: {
    front: 5,                      // front / chest
    back: 5,                       // back: set the same as the front for now
    sleeve_left: 1,                // sides
    sleeve_right: 1,
    default: 5,
  },

  // AS Colour trade cost per piece, by style code (CMGO account, base size).
  costs: {
    '5001': 10.75, '5026': 14.00, '5020': 14.75, '5025': 9.75,
    '5080': 16.75, '5052': 9.00, '5040': 16.25, '5085': 18.25,
    '5145': 39.00, '5161': 34.50, '5146': 41.50, '5151': 46.25, '5148': 43.50,
    '4001': 10.75, '4062': 9.75, '4034': 20.75, '4035': 18.25,
    '4160': 29.25, '4161': 34.50, '4168': 31.75,
    '1001': 10.75, '1082': 21.75, '1130': 9.00,
  },

  // Style a customiser product stands for when it is opened without a pick on the conveyor.
  defaultRef: {
    'tee-classic': '5026', 'tee-staple-5001': '5001', 'hoodie-heavy': '5146', 'hoodie-5146': '5146',
    'tank-crop': '4035', 'tank-reg': '5025', 'cap-sixpanel': '1130', 'tote-1001': '1001',
  },
};

/** Garment price for a style code, or null when the style has no cost on file. */
export const garmentPrice = (ref) => {
  const c = PRICING.costs[String(ref ?? '')];
  return c == null ? null : Math.round(c * (1 + PRICING.markup) * 100) / 100;
};
export const printPrice = (areaId) => PRICING.prints[areaId] ?? PRICING.prints.default;
