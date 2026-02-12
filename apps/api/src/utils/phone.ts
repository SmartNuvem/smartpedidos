export const normalizePhoneBR = (input: string | null | undefined): string | null => {
  if (!input) {
    return null;
  }

  let digits = input.replace(/\D/g, "").replace(/^0+/, "");

  if (!digits) {
    return null;
  }

  if (digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  if (digits.length !== 10 && digits.length !== 11) {
    return null;
  }

  const ddd = digits.slice(0, 2);
  const local = digits.slice(2);

  if (!/^[1-9]\d$/.test(ddd)) {
    return null;
  }

  if (local.length === 8 && !/^[2-9]\d{7}$/.test(local)) {
    return null;
  }

  if (local.length === 9 && !/^9\d{8}$/.test(local)) {
    return null;
  }

  const normalized = `55${ddd}${local}`;

  if (normalized.length < 12 || normalized.length > 13) {
    return null;
  }

  return normalized;
};
