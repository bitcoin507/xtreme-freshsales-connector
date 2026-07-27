export type Config = {
  port: number;
  publicBaseUrl: string;
  freshsalesBaseUrl: string;
  freshsalesApiKey: string;
  connectorLoginSecret: string;
  allowInsecureNoauth: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  return url.toString().replace(/\/$/, '');
}

export function loadConfig(): Config {
  const allowInsecureNoauth = process.env.ALLOW_INSECURE_NOAUTH === 'true';
  const publicBaseUrl = normalizeUrl(process.env.PUBLIC_BASE_URL?.trim() || 'http://localhost:3000');
  const loginSecret = process.env.CONNECTOR_LOGIN_SECRET?.trim() || '';

  if (!allowInsecureNoauth && loginSecret.length < 20) {
    throw new Error('CONNECTOR_LOGIN_SECRET must be at least 20 characters when authentication is enabled.');
  }

  return {
    port: Number(process.env.PORT || 3000),
    publicBaseUrl,
    freshsalesBaseUrl: normalizeUrl(required('FRESHSALES_BASE_URL')),
    freshsalesApiKey: required('FRESHSALES_API_KEY'),
    connectorLoginSecret: loginSecret,
    allowInsecureNoauth
  };
}
