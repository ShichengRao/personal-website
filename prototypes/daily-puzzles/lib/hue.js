// Hues for pieces and regions. Red means a mistake, so these skip the reds
// (roughly 320° through 360° to 35°). Golden-ratio steps through the allowed
// range keep neighbouring indexes far apart in colour.

const FROM = 35;
const SPAN = 285; // 35° (orange) to 320° (magenta)

export const safeHue = (k) => Math.round(FROM + ((k * 0.6180339887 + 0.1) % 1) * SPAN);
