import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { z, ZodTypeAny, AnyZodObject } from 'zod';
import { forbidden, unauthorized } from './errors';
import type { AuthContext } from './types';
import type { PermissionKey } from '../modules/auth/permissions';

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'tms_access',
});
registry.registerComponent('securitySchemes', 'csrfHeader', { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' });

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteContext<P, Q, B> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
  /** Present on every authenticated route. */
  auth: AuthContext;
}

interface RouteDef<P extends AnyZodObject, Q extends AnyZodObject, B extends ZodTypeAny> {
  method: Method;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  /** default true */
  auth?: boolean;
  /** All listed permissions are required. */
  permissions?: PermissionKey[];
  /** At least one of the listed permissions is required. */
  anyPermission?: PermissionKey[];
  params?: P;
  query?: Q;
  body?: B;
  multipart?: Record<string, { type: 'string' | 'file' | 'boolean'; description?: string; required?: boolean; array?: boolean }>;
  responses?: Record<number, string>;
  produces?: string;
  middleware?: RequestHandler[];
  handler: (ctx: RouteContext<z.infer<P>, z.infer<Q>, z.infer<B>>) => Promise<unknown> | unknown;
}

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * Declares an Express route and its OpenAPI documentation from one definition:
 * authentication, permission checks, Zod validation of params/query/body, and async error forwarding.
 */
export function defineRoute<
  P extends AnyZodObject = AnyZodObject,
  Q extends AnyZodObject = AnyZodObject,
  B extends ZodTypeAny = ZodTypeAny,
>(router: Router, mountPath: string, def: RouteDef<P, Q, B>) {
  const requiresAuth = def.auth !== false;

  const responses: Record<string, { description: string; content?: Record<string, { schema: object }> }> = {};
  for (const [status, description] of Object.entries(def.responses ?? { 200: 'Success' })) {
    responses[status] = def.produces
      ? { description, content: { [def.produces]: { schema: { type: 'string' } } } }
      : { description, content: { 'application/json': { schema: { type: 'object' } } } };
  }
  if (def.body || def.query || def.params || def.multipart) responses['422'] = { description: 'Validation error' };
  if (requiresAuth) {
    responses['401'] = { description: 'Not authenticated' };
    if (def.permissions?.length || def.anyPermission?.length) responses['403'] = { description: 'Forbidden' };
  }

  const perms = [
    def.permissions?.length ? `Requires: ${def.permissions.join(', ')}` : '',
    def.anyPermission?.length ? `Requires any of: ${def.anyPermission.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  registry.registerPath({
    method: def.method,
    path: toOpenApiPath(`/api${mountPath}${def.path === '/' ? '' : def.path}`),
    summary: def.summary,
    description: [def.description, perms].filter(Boolean).join('\n\n') || undefined,
    tags: def.tags,
    security: requiresAuth ? [{ cookieAuth: [], ...(def.method !== 'get' ? { csrfHeader: [] } : {}) }] : [],
    request: {
      params: def.params,
      query: def.query,
      body: def.body
        ? { content: { 'application/json': { schema: def.body } } }
        : def.multipart
          ? {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: Object.fromEntries(
                      Object.entries(def.multipart).map(([k, v]) => {
                        const item = v.type === 'file' ? { type: 'string', format: 'binary' } : { type: v.type };
                        return [k, v.array ? { type: 'array', items: item, description: v.description } : { ...item, description: v.description }];
                      }),
                    ),
                    required: Object.entries(def.multipart).filter(([, v]) => v.required).map(([k]) => k),
                  } as never,
                },
              },
            }
          : undefined,
    },
    responses: responses as never,
  });

  const handler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (requiresAuth) {
        if (!req.auth) throw unauthorized();
        if (def.permissions?.some((p) => !req.auth!.permissions.has(p))) throw forbidden();
        if (def.anyPermission?.length && !def.anyPermission.some((p) => req.auth!.permissions.has(p))) throw forbidden();
      }
      const params = def.params ? def.params.parse(req.params) : req.params;
      const query = def.query ? def.query.parse(req.query) : req.query;
      const body = def.body ? def.body.parse(req.body ?? {}) : req.body;
      const result = await def.handler({ req, res, params, query, body, auth: req.auth as AuthContext } as never);
      if (!res.headersSent && result !== undefined) res.json(result);
    } catch (err) {
      next(err);
    }
  };

  // Auth check must run before upload middleware so anonymous users can't stream files to us.
  const guard: RequestHandler = (req, _res, next) => {
    if (requiresAuth && !req.auth) return next(unauthorized());
    next();
  };

  const expressPath = mountPath + (def.path === '/' && mountPath ? '' : def.path);
  router[def.method](expressPath, guard, ...(def.middleware ?? []), handler);
}
