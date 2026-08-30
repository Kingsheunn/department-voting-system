export function addCalendarMonths(value, months) {
  const date = new Date(value);
  if (!Number.isInteger(months) || !Number.isFinite(date.getTime())) {
    throw new Error("Retention date is invalid");
  }
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

export function auditDeleteAfter(value) {
  return addCalendarMonths(value, 12);
}
