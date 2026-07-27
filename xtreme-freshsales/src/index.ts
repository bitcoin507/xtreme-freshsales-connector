import { randomUUID } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { FreshsalesClient } from './freshsales.js';
import { loginGate, SingleUserOAuthProvider } from './auth.js';
import { createServer } from './tools.js';

const config = loadConfig();
const mcpUrl = new URL('/mcp', config.publicBaseUrl);
const client = new FreshsalesClient(config.freshsalesBaseUrl, config.freshsalesApiKey);
const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: [new URL(config.publicBaseUrl).hostname]
});
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

let mcpAuth: express.RequestHandler = (_req, _res, next) => next();
if (!config.allowInsecureNoauth) {
  const provider = new SingleUserOAuthProvider(mcpUrl.toString());
  app.use('/authorize', loginGate(config.connectorLoginSecret, mcpUrl.protocol === 'https:'));
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.publicBaseUrl),
    resourceServerUrl: mcpUrl,
    scopesSupported: ['freshsales:read', 'freshsales:write'],
    resourceName: 'Xtreme Freshsales CRM'
  }));
  mcpAuth = requireBearerAuth({
    verifier: provider,
    requiredScopes: ['freshsales:read'],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl)
  });
} else {
  console.warn('WARNING: ALLOW_INSECURE_NOAUTH=true. Use only with a secure local MCP tunnel.');
}

app.get('/', (_req, res) => res.json({ name: 'Xtreme Freshsales Connector', status: 'ok', mcp: '/mcp' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post('/mcp', mcpAuth, async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Missing or invalid MCP session.' }, id: null });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => {
          transports.set(id, transport!);
        }
      });
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };
      await createServer(client).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

app.get('/mcp', mcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', mcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Invalid MCP session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Xtreme Freshsales connector listening on port ${config.port}`);
});
