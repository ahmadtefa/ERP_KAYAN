export function isCorsOriginAllowed(
  origin: string | undefined,
  configuredOrigins: string[],
  isProduction: boolean,
): boolean {
  // Native apps, curl and other non-browser clients do not send Origin.
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  return !isProduction;
}
