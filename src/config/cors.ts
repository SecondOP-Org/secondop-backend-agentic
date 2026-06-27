export const parseCorsOrigins = (value?: string): string | string[] => {
  const origins = (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return 'http://localhost:8080';
  }

  return origins.length === 1 ? origins[0] : origins;
};
