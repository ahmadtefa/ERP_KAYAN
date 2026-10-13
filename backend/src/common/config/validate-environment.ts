export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV !== 'production') return config;

  const access = typeof config.JWT_ACCESS_SECRET === 'string'
    ? config.JWT_ACCESS_SECRET.trim()
    : '';
  const refresh = typeof config.JWT_REFRESH_SECRET === 'string'
    ? config.JWT_REFRESH_SECRET.trim()
    : '';

  const isPlaceholder = (value: string) =>
    /^(replace-with|change_me|changeme|your[-_ ]|secret$)/i.test(value);

  if (access.length < 32 || isPlaceholder(access)) {
    throw new Error(
      'Production requires JWT_ACCESS_SECRET to be a unique random secret of at least 32 characters.',
    );
  }
  if (refresh.length < 32 || isPlaceholder(refresh)) {
    throw new Error(
      'Production requires JWT_REFRESH_SECRET to be a unique random secret of at least 32 characters.',
    );
  }
  if (access === refresh) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values in production.',
    );
  }

  return config;
}
