import assert from 'node:assert/strict';
import test from 'node:test';
import { createXtremeOpenApiDocument } from '../src/openapi.js';

test('Custom GPT action schema explicitly exposes the Freshsales LinkedIn field', () => {
  const document = createXtremeOpenApiDocument('https://connector.example') as any;
  const linkedin = document.components.schemas.Fields.properties.linkedin;

  assert.equal(linkedin.type, 'string');
  assert.match(linkedin.description, /LinkedIn/i);
  assert.equal(document.info.version, '0.3.3');

  const createFields = document.paths['/api/records/{entity}'].post.requestBody.content['application/json'].schema.properties.fields.$ref;
  const updateFields = document.paths['/api/records/{entity}/{id}'].put.requestBody.content['application/json'].schema.properties.fields.$ref;

  assert.equal(createFields, '#/components/schemas/Fields');
  assert.equal(updateFields, '#/components/schemas/Fields');
});
