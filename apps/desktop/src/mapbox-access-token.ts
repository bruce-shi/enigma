export function mapboxAccessTokenConfigured(accessToken?: string): accessToken is string {
  const token = accessToken?.trim();
  return Boolean(
    token && token.length > 3 && token.length <= 2_048 && /^pk\.[\w.-]+$/u.test(token),
  );
}

export function requiredMapboxAccessToken(accessToken?: string): string {
  const token = accessToken?.trim();
  if (!mapboxAccessTokenConfigured(token)) {
    throw new Error("Add a Mapbox public token in Settings");
  }
  return token;
}
