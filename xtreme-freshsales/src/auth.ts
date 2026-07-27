import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Request, RequestHandler, Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

type CodeRecord = { clientId: string; params: AuthorizationParams; expiresAt: number };
type TokenRecord = { clientId: string; scopes: string[]; resource?: URL; expiresAt: number; type: 'access' | 'refresh' };

export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  constructor(private readonly filePath = process.env.OAUTH_CLIENTS_FILE?.trim() || '') {
    if (filePath) {
      try {
        const saved = JSON.parse(readFileSync(filePath, 'utf8')) as OAuthClientInformationFull[];
        for (const client of saved) this.clients.set(client.client_id, client);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>) {
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000)
    };
    this.clients.set(registered.client_id, registered);
    this.persist();
    return registered;
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify([...this.clients.values()], null, 2), { mode: 0o600 });
  }
}

export class SingleUserOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private readonly codes = new Map<string, CodeRecord>();
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(private readonly expectedResource: string) {}

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (!client.redirect_uris.includes(params.redirectUri)) throw new Error('Unregistered redirect URI');
    if (params.resource && params.resource.toString() !== this.expectedResource) throw new Error('Invalid resource');

    const code = randomUUID();
    this.codes.set(code, { clientId: client.client_id, params, expiresAt: Date.now() + 5 * 60_000 });
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', code);
    if (params.state) redirect.searchParams.set('state', params.state);
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now()) throw new Error('Invalid authorization code');
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const record = this.codes.get(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now()) throw new Error('Invalid authorization code');
    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, record.params.scopes || [], record.params.resource);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const record = this.tokens.get(refreshToken);
    if (!record || record.type !== 'refresh' || record.clientId !== client.client_id || record.expiresAt < Date.now()) {
      throw new Error('Invalid refresh token');
    }
    this.tokens.delete(refreshToken);
    return this.issueTokens(client.client_id, scopes || record.scopes, resource || record.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.tokens.get(token);
    if (!record || record.type !== 'access' || record.expiresAt < Date.now()) throw new Error('Invalid or expired token');
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: record.resource
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    this.tokens.delete(request.token);
  }

  private issueTokens(clientId: string, scopes: string[], resource?: URL): OAuthTokens {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    this.tokens.set(accessToken, { clientId, scopes, resource, expiresAt: Date.now() + 60 * 60_000, type: 'access' });
    this.tokens.set(refreshToken, { clientId, scopes, resource, expiresAt: Date.now() + 30 * 24 * 60 * 60_000, type: 'refresh' });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      scope: scopes.join(' ')
    };
  }
}

function parseCookies(req: Request): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
      const index = v.indexOf('=');
      return [v.slice(0, index), decodeURIComponent(v.slice(index + 1))];
    })
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionValue(secret: string): string {
  return createHash('sha256').update(`xtreme-freshsales:${secret}`).digest('base64url');
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!);
}

export function loginGate(loginSecret: string, secureCookie: boolean): RequestHandler {
  const expectedSession = sessionValue(loginSecret);
  return (req, res, next) => {
    if (safeEqual(parseCookies(req).xtreme_connector_session || '', expectedSession)) return next();
    const submitted = typeof req.body?.login_secret === 'string' ? req.body.login_secret : '';
    if (req.method === 'POST' && safeEqual(submitted, loginSecret)) {
      res.cookie('xtreme_connector_session', expectedSession, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/authorize'
      });
      delete req.body.login_secret;
      return next();
    }

    const params = req.method === 'POST' ? req.body : req.query;
    const hidden = Object.entries(params)
      .filter(([key]) => key !== 'login_secret')
      .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
      .join('');
    res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Xtreme Freshsales</title><style>body{font-family:system-ui;background:#f5f7fb;margin:0;display:grid;place-items:center;min-height:100vh}.card{background:white;padding:32px;border-radius:16px;box-shadow:0 10px 35px #0002;max-width:420px;width:calc(100% - 48px)}h1{color:#0d315d;margin-top:0}input{box-sizing:border-box;width:100%;padding:12px;margin:12px 0;border:1px solid #aaa;border-radius:8px}button{width:100%;padding:12px;border:0;border-radius:8px;background:#e76524;color:white;font-weight:700}</style></head><body><main class="card"><h1>Xtreme Freshsales</h1><p>Enter the private connector passphrase to authorize ChatGPT. This is not your Freshsales password or API key.</p><form method="post" action="/authorize">${hidden}<input type="password" name="login_secret" required autocomplete="current-password"><button type="submit">Authorize connector</button></form></main></body></html>`);
  };
}
