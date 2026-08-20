import { createOpenApiDocument } from './actions.js';

/**
 * Build the Custom GPT Actions schema and explicitly expose Freshsales' standard
 * Contact LinkedIn field. The underlying record endpoints already pass supplied
 * Freshsales fields through unchanged; this makes `linkedin` visible to the
 * assistant for both create and update operations that share the Fields schema.
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
  document.info.version = '0.3.3';

  return document;
}
