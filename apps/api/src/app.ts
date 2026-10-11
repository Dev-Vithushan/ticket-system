import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import crypto from 'node:crypto';
import { config } from './config/env';
import { openApiDocument } from './docs/openapi';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { authenticate } from './middleware/authenticate';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';
import auditRoutes from './modules/audit/audit.routes';
import authRoutes from './modules/auth/auth.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import orgRoutes from './modules/org/org.routes';
import reportRoutes from './modules/reports/reports.routes';
import roleRoutes from './modules/roles/roles.routes';
import settingsRoutes from './modules/settings/settings.routes';
import slaRoutes from './modules/sla/sla.routes';
import ticketRoutes from './modules/tickets/tickets.routes';
import userRoutes from './modules/users/users.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // swagger-ui needs inline styles/scripts on the /api/docs page only
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  const api = Router();
  api.use(globalLimiter);
  api.use(authenticate);
  api.use(csrfProtection);
  api.use(authRoutes);
  api.use(userRoutes);
  api.use(roleRoutes);
  api.use(orgRoutes);
  api.use(ticketRoutes);
  api.use(slaRoutes);
  api.use(notificationRoutes);
  api.use(reportRoutes);
  api.use(settingsRoutes);
  api.use(auditRoutes);

  // Module routers register their full paths (prefix + route) via defineRoute.
  app.use('/api', api);

  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument()));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument(), {
      customSiteTitle: 'Ticket System API',
      swaggerOptions: {
        withCredentials: true,
        persistAuthorization: true,
        // Echo the CSRF cookie so "Try it out" works with cookie authentication.
        requestInterceptor: (request: { headers: Record<string, string> }) => {
          const m = document.cookie.match(/(?:^|; )tms_csrf=([^;]+)/);
          if (m) request.headers['X-CSRF-Token'] = decodeURIComponent(m[1]);
          return request;
        },
      },
    }),
  );

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

declare const document: { cookie: string };
