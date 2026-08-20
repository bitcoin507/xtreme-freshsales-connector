import { createOpenApiDocument } from './actions.js';

/**
 * Build the Custom GPT Actions schema and explicitly expose Freshsales' standard
 * Contact LinkedIn field. The underlying record endpoints already pass supplied
 * Freshsales fields through unchanged; this makes `linkedin` visible to the
 * assistant for both create and update operations that share the Fields schema.
 *
 * The Actions API accepts either the historical Bearer token transport or a
 * dedicated X-Connector-Key header. Advertising both here keeps imported schemas
 * aligned with the runtime compatibility middleware.
 */
export function createXtremeOpenApiDocument(publicBaseUrl: string) {
  const document = createOpenApiDocument(publicBaseUrl) as any;
  const fields = document.components?.schemas?.Fields;

  if (!fields?.properties) {
    throw new Error('Freshsales OpenAPI Fields schema is missing.');
  }

  fields.properties.linkedin = {
    type: 'string',
    description: 'Verified LinkedIn profile URL for a Freshsales contact.'
  };

  document.components.securitySchemes.connectorKey = {
    type: 'apiKey',
    in: 'header',
    name: 'X-Connector-Key'
  };

  for (const pathItem of Object.values(document.paths || {}) as any[]) {
    for (const operation of Object.values(pathItem || {}) as any[]) {
      if (operation && typeof operation === 'object' && operation.security) {
        operation.security = [{ bearerAuth: [] }, { connectorKey: [] }];
      }
    }
  }

  document.info.version = '0.3.4';

  return document;
}
