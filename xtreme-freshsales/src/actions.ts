import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { FreshsalesClient, FreshsalesError, type EntityType, type JsonObject } from './freshsales.js';

const entities = new Set<EntityType>(['contacts', 'sales_accounts', 'deals']);
const taskFilters = new Set(['open', 'due_today', 'due_tomorrow', 'overdue', 'completed']);

function sameSecret(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseEntity(value: string): EntityType {
  if (!entities.has(value as EntityType)) throw Object.assign(new Error('Invalid entity type.'), { status: 400 });
  return value as EntityType;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${field} must be a positive integer.`), { status: 400 });
  }
  return parsed;
}

function objectBody(value: unknown, field = 'fields'): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`${field} must be an object.`), { status: 400 });
  }
  return value as JsonObject;
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function actionBearerAuth(secret: string): express.RequestHandler {
  return (req, res, next) => {
    const header = req.header('authorization') || '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!supplied || !sameSecret(supplied, secret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

export function createActionsRouter(client: FreshsalesClient) {
  const router = express.Router();

  router.get('/status', asyncRoute(async (_req, res) => {
    await client.healthCheck();
    res.json({ connected: true });
  }));

  router.get('/search', asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) throw Object.assign(new Error('q must contain at least 2 characters.'), { status: 400 });
    const include = String(req.query.include || 'contact,sales_account,deal');
    const limit = Math.min(100, positiveInteger(req.query.limit || 25, 'limit'));
    res.json(await client.search(query, include, limit));
  }));

  router.get('/records/:entity/:id', asyncRoute(async (req, res) => {
    res.json(await client.getEntity(parseEntity(String(req.params.entity)), positiveInteger(req.params.id, 'id')));
  }));

  router.get('/filters/:entity', asyncRoute(async (req, res) => {
    res.json(await client.listFilters(parseEntity(String(req.params.entity))));
  }));

  router.get('/records/:entity', asyncRoute(async (req, res) => {
    const viewId = positiveInteger(req.query.view_id, 'view_id');
    const page = positiveInteger(req.query.page || 1, 'page');
    const perPage = Math.min(100, positiveInteger(req.query.per_page || 100, 'per_page'));
    res.json(await client.listEntityView(parseEntity(String(req.params.entity)), viewId, page, perPage));
  }));

  router.get('/users', asyncRoute(async (_req, res) => {
    res.json(await client.listUsers());
  }));

  router.get('/tasks', asyncRoute(async (req, res) => {
    const filter = String(req.query.filter || 'open');
    if (!taskFilters.has(filter)) throw Object.assign(new Error('Invalid task filter.'), { status: 400 });
    res.json(await client.listTasks(filter));
  }));

  router.get('/tasks/:id', asyncRoute(async (req, res) => {
    res.json(await client.getTask(positiveInteger(req.params.id, 'id')));
  }));

  router.post('/records/:entity', asyncRoute(async (req, res) => {
    res.status(201).json(await client.createEntity(parseEntity(String(req.params.entity)), objectBody(req.body.fields)));
  }));

  router.put('/records/:entity/:id', asyncRoute(async (req, res) => {
    res.json(await client.updateEntity(
      parseEntity(String(req.params.entity)),
      positiveInteger(req.params.id, 'id'),
      objectBody(req.body.fields)
    ));
  }));

  router.post('/tasks', asyncRoute(async (req, res) => {
    const body = objectBody(req.body, 'request body');
    const status = body.status === 'completed' ? 1 : 0;
    res.status(201).json(await client.createTask({
      targetableId: positiveInteger(body.targetable_id, 'targetable_id'),
      targetableType: String(body.targetable_type) as 'Contact' | 'SalesAccount' | 'Deal',
      ownerId: positiveInteger(body.owner_id, 'owner_id'),
      title: String(body.title || ''),
      description: body.description === undefined ? undefined : String(body.description),
      dueDate: String(body.due_date || ''),
      status
    }));
  }));

  router.put('/tasks/:id', asyncRoute(async (req, res) => {
    res.json(await client.updateTask(positiveInteger(req.params.id, 'id'), objectBody(req.body.fields)));
  }));

  router.post('/notes', asyncRoute(async (req, res) => {
    const body = objectBody(req.body, 'request body');
    res.status(201).json(await client.addNote(
      positiveInteger(body.targetable_id, 'targetable_id'),
      String(body.targetable_type) as 'Contact' | 'SalesAccount' | 'Deal',
      String(body.description || '')
    ));
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof FreshsalesError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  });

  return router;
}

export function createOpenApiDocument(publicBaseUrl: string) {
  const entity = { type: 'string', enum: ['contacts', 'sales_accounts', 'deals'] };
  const id = { type: 'integer', minimum: 1 };
  const fields = { type: 'object', additionalProperties: true };
  const jsonResponse = {
    description: 'Successful Freshsales response',
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } }
  };
  const security = [{ bearerAuth: [] }];

  return {
    openapi: '3.1.0',
    info: {
      title: 'Xtreme Freshsales Actions',
      description: 'Private CRM actions for Xtreme Disaster Restoration Group.',
      version: '0.3.0'
    },
    servers: [{ url: publicBaseUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      },
      schemas: {
        Fields: fields,
        TaskInput: {
          type: 'object',
          required: ['targetable_id', 'targetable_type', 'owner_id', 'title', 'due_date'],
          properties: {
            targetable_id: id,
            targetable_type: { type: 'string', enum: ['Contact', 'SalesAccount', 'Deal'] },
            owner_id: id,
            title: { type: 'string' },
            description: { type: 'string' },
            due_date: { type: 'string', format: 'date-time' },
            status: { type: 'string', enum: ['open', 'completed'], default: 'open' }
          }
        }
      }
    },
    paths: {
      '/api/status': {
        get: {
          operationId: 'checkFreshsalesConnection',
          summary: 'Check the Freshsales connection',
          security,
          'x-openai-isConsequential': false,
          responses: { '200': jsonResponse }
        }
      },
      '/api/search': {
        get: {
          operationId: 'searchFreshsales',
          summary: 'Search contacts, companies, and deals',
          security,
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
            { name: 'include', in: 'query', schema: { type: 'string', default: 'contact,sales_account,deal' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }
          ],
          responses: { '200': jsonResponse }
        }
      },
      '/api/records/{entity}/{id}': {
        get: {
          operationId: 'getFreshsalesRecord',
          summary: 'Get one contact, company, or deal',
          security,
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'entity', in: 'path', required: true, schema: entity },
            { name: 'id', in: 'path', required: true, schema: id }
          ],
          responses: { '200': jsonResponse }
        },
        put: {
          operationId: 'updateFreshsalesRecord',
          summary: 'Update one inspected contact, company, or deal',
          security,
          'x-openai-isConsequential': true,
          parameters: [
            { name: 'entity', in: 'path', required: true, schema: entity },
            { name: 'id', in: 'path', required: true, schema: id }
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['fields'],
              properties: { fields: { $ref: '#/components/schemas/Fields' } }
            } } }
          },
          responses: { '200': jsonResponse }
        }
      },
      '/api/filters/{entity}': {
        get: {
          operationId: 'listFreshsalesFilters',
          summary: 'List saved Freshsales views and their IDs',
          security,
          'x-openai-isConsequential': false,
          parameters: [{ name: 'entity', in: 'path', required: true, schema: entity }],
          responses: { '200': jsonResponse }
        }
      },
      '/api/records/{entity}': {
        get: {
          operationId: 'listFreshsalesRecords',
          summary: 'List records from a saved Freshsales view',
          security,
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'entity', in: 'path', required: true, schema: entity },
            { name: 'view_id', in: 'query', required: true, schema: id },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'per_page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } }
          ],
          responses: { '200': jsonResponse }
        },
        post: {
          operationId: 'createFreshsalesRecord',
          summary: 'Create one contact, company, or deal after checking for duplicates',
          security,
          'x-openai-isConsequential': true,
          parameters: [{ name: 'entity', in: 'path', required: true, schema: entity }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['fields'],
              properties: { fields: { $ref: '#/components/schemas/Fields' } }
            } } }
          },
          responses: { '201': jsonResponse }
        }
      },
      '/api/users': {
        get: {
          operationId: 'listFreshsalesUsers',
          summary: 'List CRM owners for assigning records and tasks',
          security,
          'x-openai-isConsequential': false,
          responses: { '200': jsonResponse }
        }
      },
      '/api/tasks': {
        get: {
          operationId: 'listFreshsalesTasks',
          summary: 'List open, due, overdue, or completed tasks',
          security,
          'x-openai-isConsequential': false,
          parameters: [{
            name: 'filter',
            in: 'query',
            schema: { type: 'string', enum: ['open', 'due_today', 'due_tomorrow', 'overdue', 'completed'], default: 'open' }
          }],
          responses: { '200': jsonResponse }
        },
        post: {
          operationId: 'createFreshsalesTask',
          summary: 'Create and assign a follow-up task',
          security,
          'x-openai-isConsequential': true,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskInput' } } }
          },
          responses: { '201': jsonResponse }
        }
      },
      '/api/tasks/{id}': {
        get: {
          operationId: 'getFreshsalesTask',
          summary: 'Get one task and its related CRM context',
          security,
          'x-openai-isConsequential': false,
          parameters: [{ name: 'id', in: 'path', required: true, schema: id }],
          responses: { '200': jsonResponse }
        },
        put: {
          operationId: 'updateFreshsalesTask',
          summary: 'Edit, reschedule, reassign, or complete an inspected task',
          security,
          'x-openai-isConsequential': true,
          parameters: [{ name: 'id', in: 'path', required: true, schema: id }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['fields'],
              properties: { fields: { $ref: '#/components/schemas/Fields' } }
            } } }
          },
          responses: { '200': jsonResponse }
        }
      },
      '/api/notes': {
        post: {
          operationId: 'addFreshsalesNote',
          summary: 'Add a CRM note to a contact, company, or deal',
          security,
          'x-openai-isConsequential': true,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['targetable_id', 'targetable_type', 'description'],
              properties: {
                targetable_id: id,
                targetable_type: { type: 'string', enum: ['Contact', 'SalesAccount', 'Deal'] },
                description: { type: 'string' }
              }
            } } }
          },
          responses: { '201': jsonResponse }
        }
      }
    }
  };
}
