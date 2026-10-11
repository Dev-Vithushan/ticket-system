import crypto from 'node:crypto';
import type { Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/lib/password';
import { prisma } from '../../src/lib/prisma';

export const PASSWORD = 'Str0ngPassw0rd!';
let cachedHash: string | undefined;
const uid = () => crypto.randomUUID().slice(0, 8);

export const app = createApp();

export type RoleKey = 'SUPER_ADMIN' | 'SUPPORT_MANAGER' | 'SUPPORT_AGENT' | 'CUSTOMER';

export async function createUser(role: RoleKey, overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  cachedHash ??= await hashPassword(PASSWORD);
  const r = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  return prisma.user.create({
    data: { email: `${role.toLowerCase()}-${uid()}@test.local`, name: `${role} ${uid()}`, passwordHash: cachedHash, roleId: r.id, ...overrides },
  });
}

export async function createTeam(name = `Team ${uid()}`, members: { userId: string; role?: 'MEMBER' | 'LEAD' }[] = []) {
  const dept = await prisma.department.create({ data: { name: `Dept ${uid()}` } });
  return prisma.team.create({
    data: { name, departmentId: dept.id, members: { create: members.map((m) => ({ userId: m.userId, role: m.role ?? 'MEMBER' })) } },
  });
}

export async function createCategory(defaultTeamId?: string) {
  const parent = await prisma.ticketCategory.create({ data: { name: `Cat ${uid()}`, defaultTeamId } });
  const child = await prisma.ticketCategory.create({ data: { name: `Sub ${uid()}`, parentId: parent.id } });
  return { parent, child };
}

/** Inserts a ticket directly (bypassing the API) for setting up specific states. */
export async function insertTicket(data: {
  requesterId: string;
  teamId?: string | null;
  assigneeId?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
  subject?: string;
  createdAt?: Date;
  resolvedAt?: Date | null;
  firstResponseDueAt?: Date | null;
  resolutionDueAt?: Date | null;
  resolutionNotes?: string | null;
}) {
  return prisma.ticket.create({
    data: {
      number: `TST-${uid()}`,
      subject: data.subject ?? 'Inserted test ticket',
      description: 'Inserted directly for test setup purposes',
      requesterId: data.requesterId,
      createdById: data.requesterId,
      teamId: data.teamId ?? null,
      assigneeId: data.assigneeId ?? null,
      status: data.status ?? 'OPEN',
      priority: data.priority ?? 'MEDIUM',
      createdAt: data.createdAt,
      resolvedAt: data.resolvedAt ?? null,
      firstResponseDueAt: data.firstResponseDueAt ?? null,
      resolutionDueAt: data.resolutionDueAt ?? null,
      resolutionNotes: data.resolutionNotes ?? null,
    },
  });
}

/** A logged-in HTTP client that carries cookies and the CSRF header automatically. */
export class Client {
  agent = request.agent(app);
  csrf = '';

  static async as(user: { email: string }, password = PASSWORD) {
    const c = new Client();
    await c.init();
    const res = await c.post('/api/auth/login', { email: user.email, password });
    if (res.status !== 200) throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
    return c;
  }

  static async anonymous() {
    const c = new Client();
    await c.init();
    return c;
  }

  async init() {
    const res = await this.agent.get('/api/auth/csrf');
    this.csrf = res.body.data.csrfToken;
  }

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  patch(url: string, body?: object) {
    return this.agent.patch(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  put(url: string, body?: object) {
    return this.agent.put(url).set('X-CSRF-Token', this.csrf).send(body ?? {});
  }
  delete(url: string) {
    return this.agent.delete(url).set('X-CSRF-Token', this.csrf);
  }
  upload(url: string) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrf);
  }
}

/** Standard org fixture: one support team with a manager (lead) and two agents, a second team, and customers. */
export async function standardFixture() {
  const admin = await createUser('SUPER_ADMIN');
  const manager = await createUser('SUPPORT_MANAGER');
  const agent = await createUser('SUPPORT_AGENT');
  const agent2 = await createUser('SUPPORT_AGENT');
  const outsider = await createUser('SUPPORT_AGENT');
  const customer = await createUser('CUSTOMER');
  const customer2 = await createUser('CUSTOMER');
  const team = await createTeam('Support', [{ userId: manager.id, role: 'LEAD' }, { userId: agent.id }, { userId: agent2.id }]);
  const otherTeam = await createTeam('Other', [{ userId: outsider.id }]);
  const category = await createCategory(team.id);
  return { admin, manager, agent, agent2, outsider, customer, customer2, team, otherTeam, category };
}
