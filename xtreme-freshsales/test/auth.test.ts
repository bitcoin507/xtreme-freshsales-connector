import assert from 'node:assert/strict';
import test from 'node:test';
import { SingleUserOAuthProvider } from '../src/auth.js';

test('OAuth provider issues and verifies scoped access tokens', async () => {
  const provider = new SingleUserOAuthProvider('https://connector.example/mcp');
  const client = await provider.clientsStore.registerClient!({
    redirect_uris: ['https://chatgpt.com/connector/oauth/test'],
    token_endpoint_auth_method: 'none'
  });
  let redirect = '';
  const res = { redirect: (url: string) => { redirect = url; } } as any;

  await provider.authorize(client, {
    redirectUri: client.redirect_uris[0],
    codeChallenge: 'test-challenge',
    scopes: ['freshsales:read'],
    resource: new URL('https://connector.example/mcp')
  }, res);
  const code = new URL(redirect).searchParams.get('code');
  assert.ok(code);
  assert.equal(await provider.challengeForAuthorizationCode(client, code), 'test-challenge');

  const tokens = await provider.exchangeAuthorizationCode(client, code);
  const info = await provider.verifyAccessToken(tokens.access_token);
  assert.deepEqual(info.scopes, ['freshsales:read']);
  assert.equal(info.clientId, client.client_id);
});
