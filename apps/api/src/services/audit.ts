import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
}

/** Records a security-relevant or administrative action. Failures are logged, never thrown. */
export async function audit(input: AuditInput, tx: Tx = prisma) {
  try {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? input.req?.auth?.user.id ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        ipAddress: input.req?.ip,
        userAgent: input.req?.get('user-agent')?.slice(0, 500),
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Failed to write audit log');
  }
}
