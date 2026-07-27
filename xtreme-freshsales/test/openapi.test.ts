import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenApiDocument } from '../src/actions.js';

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [key: string]: unknown;
};

function findPropertylessObjects(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];

  const schema = value as JsonSchema;
  const failures: string[] = [];
  if (schema.type === 'object') {
    if (!schema.properties || Object.keys(schema.properties).length === 0) {
      failures.push(path);
    }
  }

  for (const [key, child] of Object.entries(schema)) {
    if (child && typeof child === 'object') {
      failures.push(...findPropertylessObjects(child, `${path}.${key}`));
    }
  }
  return failures;
}

test('OpenAPI document gives every object schema at least one property', () => {
  const document = createOpenApiDocument('https://connector.example');
  assert.deepEqual(findPropertylessObjects(document), []);
});

test('OpenAPI document exposes unique operation IDs and valid server URL', () => {
  const document = createOpenApiDocument('https://connector.example') as any;
  const operationIds = Object.values(document.paths)
    .flatMap((pathItem: any) => Object.values(pathItem))
    .map((operation: any) => operation.operationId)
    .filter(Boolean);

  assert.equal(new Set(operationIds).size, operationIds.length);
  assert.equal(document.servers[0].url, 'https://connector.example');
});
