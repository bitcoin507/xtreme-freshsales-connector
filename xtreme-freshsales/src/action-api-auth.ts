import { timingSafeEqual } from 'node:crypto';
import express from 'express';

function sameSecret(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/**
 * Auth middleware for Custom GPT Actions.
 *
 * Accepts three compatible credential transports so the connector works with
 * different Action authentication modes without weakening the shared secret:
 * - Authorization: Bearer <secret>
 * - Authorization: <secret>
 * - X-Connector-Key: <secret>
 *
 * Error responses intentionally expose only whether a credential was missing or
 * mismatched, never the configured secret itself.
 */
export function actionApiAuth(secret: string): express.RequestHandler {
  return (req, res, next) => {
    const authorization = (req.header('authorization') || '').trim();
    const customHeader = (req.header('x-connector-key') || '').trim();
    const hasBearerPrefix = authorization.toLowerCase().startsWith('bearer ');
    const bearerValue = hasBearerPrefix ? authorization.slice(7).trim() : '';
    const rawAuthorizationValue = authorization && !hasBearerPrefix ? authorization : '';

    const candidates = [
      { source: 'bearer', value: bearerValue },
      { source: 'authorization', value: rawAuthorizationValue },
      { source: 'x-connector-key', value: customHeader }
    ].filter(candidate => candidate.value.length > 0);

    if (candidates.length === 0) {
      res.status(401).json({
        error: 'Unauthorized',
        reason: 'missing_connector_credential'
      });
      return;
    }

    if (candidates.some(candidate => sameSecret(candidate.value, secret))) {
      next();
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      reason: 'connector_credential_mismatch',
      credential_sources: candidates.map(candidate => candidate.source)
    });
  };
}
