import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from '../lib/route';

let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function openApiDocument() {
  cached ??= new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Ticket Management System API',
      version: '1.0.0',
      description: [
        'REST API for the ticket management system.',
        '',
        '**Authentication:** `POST /api/auth/login` sets an HttpOnly `tms_access` cookie. Browser clients must call',
        '`GET /api/auth/csrf` and send the token in the `X-CSRF-Token` header on state-changing requests.',
        'In this Swagger UI the CSRF header is added automatically: call `/api/auth/csrf`, then `/api/auth/login`, then try other endpoints.',
        '',
        '**Responses:** success → `{ data, meta? }`; error → `{ error: { code, message, details? } }`.',
      ].join('\n'),
    },
    servers: [{ url: '/' }],
  });
  return cached;
}
