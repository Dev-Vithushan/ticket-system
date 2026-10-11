/**
 * Database seed.
 *
 *  - Always: permission catalogue, system roles, default SLA policies and business hours.
 *  - NODE_ENV=production: additionally creates ONE Super Admin from ADMIN_EMAIL / ADMIN_PASSWORD (required, no defaults).
 *  - Otherwise: development sample data with DEVELOPMENT-ONLY credentials (see README). Never use these in production.
 */
import type { TicketPriority, TicketStatus, TicketSource, Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { hashPassword, passwordSchema } from '../src/lib/password';
import { syncReferenceData } from '../src/services/bootstrap';
import { loadCalendar } from '../src/modules/sla/sla.service';
import { addBusinessMinutes, alwaysOpenCalendar } from '../src/modules/sla/businessTime';
import { formatTicketNumber } from '../src/modules/tickets/numbering';
import { DEFAULT_SETTINGS } from '../src/services/settings';

const DEV_PASSWORD = 'Password123!'; // DEVELOPMENT ONLY

// Deterministic PRNG so every developer gets the same dataset
let seed = 20260101;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));
const weighted = <T>(items: [T, number][]): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
};
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

async function seedProductionAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed a production Super Admin');
  const valid = passwordSchema.safeParse(password);
  if (!valid.success) throw new Error(`ADMIN_PASSWORD rejected: ${valid.error.issues.map((i) => i.message).join('; ')}`);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`Super Admin ${email} already exists — unchanged.`);
    return;
  }
  await prisma.user.create({ data: { email, name: process.env.ADMIN_NAME ?? 'Administrator', passwordHash: await hashPassword(password), roleId: role.id } });
  console.log(`Created Super Admin ${email}.`);
}

const CATEGORY_TREE: { name: string; team: string; subs: string[] }[] = [
  { name: 'Technical Issue', team: 'Technical Support', subs: ['Login & Access', 'Performance', 'Bug Report', 'Integration / API'] },
  { name: 'Billing', team: 'Billing', subs: ['Invoice Query', 'Refund Request', 'Payment Failure'] },
  { name: 'Account Management', team: 'Customer Success', subs: ['Profile Update', 'Subscription Change', 'Data Export'] },
  { name: 'Internal IT', team: 'IT Service Desk', subs: ['Hardware', 'Software Installation', 'Network / VPN', 'Access Request'] },
  { name: 'Incident', team: 'Technical Support', subs: ['Service Outage', 'Security Incident'] },
];

const SUBJECTS: Record<string, string[]> = {
  'Login & Access': ['Unable to log in after password reset', 'Two-factor code not arriving', 'Account locked after failed attempts', 'SSO login redirects in a loop'],
  Performance: ['Dashboard takes over 30 seconds to load', 'Reports page times out', 'Search is very slow since last update', 'Mobile app freezes on sync'],
  'Bug Report': ['Export to PDF cuts off the last column', 'Date picker shows wrong month', 'Duplicate notifications for each comment', 'Unsaved changes warning appears incorrectly'],
  'Integration / API': ['Webhook deliveries failing with 401', 'API rate limit reached unexpectedly', 'Salesforce sync missing contacts', 'OAuth token refresh returns invalid_grant'],
  'Invoice Query': ['Invoice shows incorrect VAT amount', 'Need a copy of last quarter invoices', 'Invoice address needs updating', 'Charged for seats we removed'],
  'Refund Request': ['Refund for duplicate payment', 'Request refund for unused annual plan', 'Partial refund after downgrade'],
  'Payment Failure': ['Card declined on renewal', 'Payment stuck in pending state', 'Bank transfer not reflected on account'],
  'Profile Update': ['Change company name on account', 'Update primary contact email', 'Transfer account ownership'],
  'Subscription Change': ['Upgrade to Enterprise plan', 'Add 15 additional seats', 'Switch from monthly to annual billing'],
  'Data Export': ['Full data export for compliance audit', 'GDPR data access request', 'Export ticket history to CSV'],
  Hardware: ['Laptop battery not charging', 'Second monitor not detected', 'Keyboard replacement needed', 'Docking station disconnects randomly'],
  'Software Installation': ['Install Adobe Acrobat Pro', 'Request Visual Studio Code license', 'Office update failing with error 30088'],
  'Network / VPN': ['VPN disconnects every 10 minutes', 'Cannot reach internal wiki from office', 'Wi-Fi drops in meeting room 3'],
  'Access Request': ['Access to finance shared drive', 'Add me to the #incident Slack channel', 'Production database read-only access'],
  'Service Outage': ['Customer portal returning 502 errors', 'Email notifications not being sent', 'Payments API down in EU region'],
  'Security Incident': ['Suspicious login from unknown location', 'Phishing email reported by staff', 'Possible leaked API key in public repo'],
};

const DESCRIPTIONS = [
  'This started this morning and is affecting several people on our team. We have tried clearing cache and restarting without success.',
  'Steps to reproduce: 1) open the page, 2) apply the filter, 3) click export. Expected a complete file, but the result is incomplete.',
  'This is blocking our month-end process, so we would appreciate a quick response. Screenshots can be provided on request.',
  'We noticed this after the latest release. It worked fine last week. Please advise if there is a workaround in the meantime.',
  'Several customers have reported the same behaviour. Happy to jump on a call if that helps diagnose the issue.',
];

const AGENT_REPLIES = [
  'Thanks for reaching out. I am looking into this now and will update you shortly.',
  'Could you please confirm the browser and version you are using, and send a screenshot of the error?',
  'I have reproduced the issue and escalated it to our engineering team. I will keep you posted.',
  'We have applied a fix on our side. Could you please try again and let us know if it works?',
];
const CUSTOMER_REPLIES = ['Thanks, here is the screenshot you asked for.', 'I tried again and it still happens.', 'That worked, thank you!', 'Any update on this?'];
const INTERNAL_NOTES = [
  'Checked logs — error correlates with the deployment at 09:40. Rolling back config flag.',
  'Customer is on the Enterprise plan; prioritise accordingly.',
  'Possible duplicate of an earlier ticket from the same organisation.',
  'Waiting on vendor response, ETA tomorrow.',
];
const RESOLUTIONS = [
  'Root cause identified as a misconfigured permission set. Corrected and verified with the customer.',
  'Applied hotfix 2.14.3 which resolves the issue. Customer confirmed.',
  'Provided step-by-step instructions; customer completed the change successfully.',
  'Refund processed to the original payment method (3–5 business days).',
  'Replaced faulty hardware and confirmed device is operating normally.',
];

async function seedDevelopmentData() {
  if ((await prisma.ticket.count()) > 0) {
    console.log('Tickets already exist — skipping sample data (run `npm run db:reset` for a clean dataset).');
    return;
  }
  const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const passwordHash = await hashPassword(DEV_PASSWORD);

  await prisma.systemSetting.upsert({ where: { key: 'organizationName' }, create: { key: 'organizationName', value: 'Acme Support Desk' }, update: {} });
  await prisma.systemSetting.upsert({ where: { key: 'allowSelfRegistration' }, create: { key: 'allowSelfRegistration', value: true }, update: {} });

  // Departments & teams
  const dept = async (name: string, description: string) => prisma.department.create({ data: { name, description } });
  const support = await dept('Customer Support', 'External customer-facing support');
  const itops = await dept('IT Operations', 'Internal IT service desk and infrastructure');
  const finance = await dept('Billing & Finance', 'Invoices, payments and refunds');
  const team = async (name: string, departmentId: string, description: string) => prisma.team.create({ data: { name, departmentId, description } });
  const teams = {
    'Technical Support': await team('Technical Support', support.id, 'Product and technical issues'),
    'Customer Success': await team('Customer Success', support.id, 'Account and subscription management'),
    'IT Service Desk': await team('IT Service Desk', itops.id, 'Internal hardware, software and access'),
    Billing: await team('Billing', finance.id, 'Billing questions and payment issues'),
  };

  const user = (email: string, name: string, roleKey: string, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) =>
    prisma.user.create({ data: { email, name, passwordHash, roleId: roles[roleKey], ...extra } });

  await user('admin@example.com', 'Alex Admin', 'SUPER_ADMIN', { jobTitle: 'System Administrator', departmentId: itops.id });
  const managers = [
    await user('manager@example.com', 'Morgan Lee', 'SUPPORT_MANAGER', { jobTitle: 'Head of Support', departmentId: support.id }),
    await user('it.manager@example.com', 'Priya Natarajan', 'SUPPORT_MANAGER', { jobTitle: 'IT Service Manager', departmentId: itops.id }),
  ];
  const agentDefs: [string, string, keyof typeof teams][] = [
    ['agent@example.com', 'Sam Rivera', 'Technical Support'],
    ['jordan.kim@example.com', 'Jordan Kim', 'Technical Support'],
    ['taylor.brooks@example.com', 'Taylor Brooks', 'Customer Success'],
    ['casey.morgan@example.com', 'Casey Morgan', 'IT Service Desk'],
    ['riley.chen@example.com', 'Riley Chen', 'IT Service Desk'],
    ['drew.patel@example.com', 'Drew Patel', 'Billing'],
  ];
  const agents: { id: string; team: keyof typeof teams }[] = [];
  for (const [email, name, t] of agentDefs) {
    const u = await user(email, name, 'SUPPORT_AGENT', { jobTitle: 'Support Agent', departmentId: teams[t].departmentId });
    agents.push({ id: u.id, team: t });
    await prisma.teamMembership.create({ data: { teamId: teams[t].id, userId: u.id } });
  }
  // Sam also covers Billing overflow
  await prisma.teamMembership.create({ data: { teamId: teams.Billing.id, userId: agents[0].id } });
  for (const t of ['Technical Support', 'Customer Success', 'Billing'] as const) {
    await prisma.teamMembership.create({ data: { teamId: teams[t].id, userId: managers[0].id, role: 'LEAD' } });
  }
  await prisma.teamMembership.create({ data: { teamId: teams['IT Service Desk'].id, userId: managers[1].id, role: 'LEAD' } });

  const customerDefs = [
    ['customer@example.com', 'Chris Customer', 'Globex Corporation'],
    ['nina.alvarez@initech.example', 'Nina Alvarez', 'Initech'],
    ['omar.haddad@umbrella.example', 'Omar Haddad', 'Umbrella Health'],
    ['grace.okafor@stark.example', 'Grace Okafor', 'Stark Logistics'],
    ['li.wei@wayne.example', 'Li Wei', 'Wayne Retail'],
    ['sofia.rossi@hooli.example', 'Sofia Rossi', 'Hooli'],
    ['ben.carter@vandelay.example', 'Ben Carter', 'Vandelay Imports'],
    ['emma.schmidt@soylent.example', 'Emma Schmidt', 'Soylent Foods'],
  ];
  const customers = [];
  for (const [email, name, org] of customerDefs) customers.push(await user(email, name, 'CUSTOMER', { organization: org }));
  const internalStaff = [...managers, ...(await prisma.user.findMany({ where: { role: { key: 'SUPPORT_AGENT' } } }))];

  // Categories
  const subcats: { id: string; parentId: string; name: string; teamId: string; internal: boolean }[] = [];
  for (const c of CATEGORY_TREE) {
    const parent = await prisma.ticketCategory.create({ data: { name: c.name, defaultTeamId: teams[c.team as keyof typeof teams].id } });
    for (const s of c.subs) {
      const sub = await prisma.ticketCategory.create({ data: { name: s, parentId: parent.id } });
      subcats.push({ id: sub.id, parentId: parent.id, name: s, teamId: parent.defaultTeamId!, internal: c.name === 'Internal IT' });
    }
  }
  const tags = await Promise.all(
    [['vip', '#a855f7'], ['bug', '#ef4444'], ['feature-request', '#3b82f6'], ['outage', '#dc2626'], ['mobile', '#14b8a6'], ['api', '#f59e0b'], ['follow-up', '#64748b']].map(
      ([name, color]) => prisma.tag.create({ data: { name, color } }),
    ),
  );
  await prisma.holiday.createMany({
    data: [
      { date: new Date('2026-12-25T00:00:00Z'), name: 'Christmas Day' },
      { date: new Date('2026-12-26T00:00:00Z'), name: 'Boxing Day' },
      { date: new Date('2027-01-01T00:00:00Z'), name: "New Year's Day" },
    ],
  });

  // Tickets with realistic lifecycles
  const calendar = await loadCalendar();
  const policies = new Map((await prisma.slaPolicy.findMany()).map((p) => [p.priority, p]));
  const now = new Date();
  const N = 140;
  const specs = Array.from({ length: N }, () => {
    const daysAgo = Math.pow(rand(), 1.4) * 75; // more recent tickets
    const created = new Date(now.getTime() - daysAgo * 86_400_000);
    created.setUTCHours(between(7, 18), between(0, 59), between(0, 59), 0);
    return created > now ? new Date(now.getTime() - between(30, 600) * 60_000) : created;
  }).sort((a, b) => a.getTime() - b.getTime());

  const yearSeq = new Map<number, number>();
  let i = 0;
  for (const createdAt of specs) {
    i++;
    const sub = pick(subcats);
    const isOutage = sub.name === 'Service Outage' || sub.name === 'Security Incident';
    const priority: TicketPriority = isOutage
      ? weighted([['CRITICAL', 6], ['HIGH', 3]])
      : weighted([['LOW', 3], ['MEDIUM', 5], ['HIGH', 2.5], ['CRITICAL', 0.6]]);
    const requester = sub.internal ? pick(internalStaff) : pick(customers);
    const source: TicketSource = sub.internal ? 'INTERNAL' : weighted([['WEB', 6], ['EMAIL', 3], ['PHONE', 1]]);
    const teamAgents = agents.filter((a) => a.team === Object.keys(teams).find((k) => teams[k as keyof typeof teams].id === sub.teamId));
    const policy = policies.get(priority)!;
    const cal = policy.useBusinessHours ? calendar : alwaysOpenCalendar(calendar.timezone);
    const firstResponseDueAt = addBusinessMinutes(createdAt, policy.firstResponseMinutes, cal);
    const resolutionDueAt = addBusinessMinutes(createdAt, policy.resolutionMinutes, cal);
    const ageHours = (now.getTime() - createdAt.getTime()) / 3_600_000;

    // Decide lifecycle by age
    const stage: TicketStatus =
      ageHours < 3
        ? weighted([['OPEN', 5], ['ASSIGNED', 3], ['IN_PROGRESS', 2]])
        : ageHours < 72
          ? weighted([['ASSIGNED', 2], ['IN_PROGRESS', 4], ['PENDING_CUSTOMER', 2], ['ESCALATED', 1], ['RESOLVED', 3], ['OPEN', 1]])
          : weighted([['CLOSED', 10], ['RESOLVED', 2], ['IN_PROGRESS', 1], ['PENDING_CUSTOMER', 0.7], ['ESCALATED', 0.4]]);
    const assigned = stage !== 'OPEN';
    const assigneeId = assigned && teamAgents.length ? pick(teamAgents).id : null;
    const status: TicketStatus = assigned && !assigneeId ? 'OPEN' : stage;

    const assignedAt = addMin(createdAt, between(2, 90));
    // Breach some first responses on purpose (~18%)
    const frLate = rand() < 0.18;
    const frSpan = Math.max(1, (firstResponseDueAt.getTime() - createdAt.getTime()) / 60_000);
    const firstResponseAt =
      status === 'OPEN' || (status === 'ASSIGNED' && rand() < 0.5)
        ? null
        : addMin(createdAt, frLate ? frSpan * (1.1 + rand()) : frSpan * (0.1 + rand() * 0.8));
    const resSpan = Math.max(1, (resolutionDueAt.getTime() - createdAt.getTime()) / 60_000);
    const done = status === 'RESOLVED' || status === 'CLOSED';
    let resolvedAt = done ? addMin(createdAt, rand() < 0.2 ? resSpan * (1.05 + rand()) : resSpan * (0.2 + rand() * 0.75)) : null;
    if (resolvedAt && firstResponseAt && resolvedAt < firstResponseAt) resolvedAt = addMin(firstResponseAt, between(30, 240));
    if (resolvedAt && resolvedAt > now) resolvedAt = addMin(now, -between(10, 120));
    const closedAt = status === 'CLOSED' && resolvedAt ? addMin(resolvedAt, between(60, 4 * 24 * 60)) : null;
    const safeClosed = closedAt && closedAt > now ? addMin(now, -5) : closedAt;
    const refNow = resolvedAt ?? now;
    const frBreached = firstResponseDueAt < (firstResponseAt ?? resolvedAt ?? now) ? firstResponseDueAt : null;
    const resBreached = resolutionDueAt < refNow && status !== 'PENDING_CUSTOMER' ? resolutionDueAt : null;
    const reopenCount = done && rand() < 0.08 ? 1 : 0;

    const year = createdAt.getUTCFullYear();
    const seq = (yearSeq.get(year) ?? 0) + 1;
    yearSeq.set(year, seq);
    const number = formatTicketNumber(DEFAULT_SETTINGS, year, seq);
    const subject = pick(SUBJECTS[sub.name] ?? ['General enquiry']);
    const t = await prisma.ticket.create({
      data: {
        number,
        subject,
        description: pick(DESCRIPTIONS),
        status,
        priority,
        source,
        requesterId: requester.id,
        createdById: source === 'PHONE' && assigneeId ? assigneeId : requester.id,
        assigneeId,
        teamId: sub.teamId,
        categoryId: sub.parentId,
        subcategoryId: sub.id,
        firstResponseDueAt,
        resolutionDueAt,
        firstResponseAt,
        firstResponseBreachedAt: frBreached,
        resolutionBreachedAt: resBreached,
        escalationLevel: status === 'ESCALATED' ? 1 : 0,
        escalatedAt: status === 'ESCALATED' ? addMin(createdAt, between(60, 600)) : null,
        slaPausedAt: status === 'PENDING_CUSTOMER' ? addMin(now, -between(60, 1440)) : null,
        resolutionNotes: done ? pick(RESOLUTIONS) : null,
        resolvedAt,
        closedAt: safeClosed,
        reopenCount,
        createdAt,
        updatedAt: safeClosed ?? resolvedAt ?? firstResponseAt ?? createdAt,
        tags: rand() < 0.45 ? { create: [{ tagId: pick(tags).id }] } : undefined,
      },
    });

    const history: Prisma.TicketHistoryCreateManyInput[] = [
      { ticketId: t.id, actorId: requester.id, action: 'CREATED', newValue: 'OPEN', createdAt },
    ];
    const comments: Prisma.TicketCommentCreateManyInput[] = [];
    if (assigneeId) {
      await prisma.ticketAssignment.create({ data: { ticketId: t.id, assigneeId, teamId: sub.teamId, assignedById: managers[0].id, assignedAt } });
      const agentName = internalStaff.find((u) => u.id === assigneeId)?.name ?? null;
      history.push({ ticketId: t.id, actorId: managers[0].id, action: 'ASSIGNED', field: 'assignee', newValue: agentName, createdAt: assignedAt });
      history.push({ ticketId: t.id, actorId: managers[0].id, action: 'STATUS_CHANGED', field: 'status', oldValue: 'OPEN', newValue: 'ASSIGNED', createdAt: assignedAt });
    }
    if (firstResponseAt && assigneeId) {
      comments.push({ ticketId: t.id, authorId: assigneeId, body: pick(AGENT_REPLIES), isInternal: false, createdAt: firstResponseAt });
      history.push({ ticketId: t.id, actorId: assigneeId, action: 'COMMENT_ADDED', createdAt: firstResponseAt });
      if (status !== 'ASSIGNED') {
        history.push({ ticketId: t.id, actorId: assigneeId, action: 'STATUS_CHANGED', field: 'status', oldValue: 'ASSIGNED', newValue: 'IN_PROGRESS', createdAt: firstResponseAt });
      }
      if (rand() < 0.5) {
        const at = addMin(firstResponseAt, between(10, 120));
        if (at < now) {
          comments.push({ ticketId: t.id, authorId: assigneeId, body: pick(INTERNAL_NOTES), isInternal: true, createdAt: at });
          history.push({ ticketId: t.id, actorId: assigneeId, action: 'INTERNAL_NOTE_ADDED', isInternal: true, createdAt: at });
        }
      }
      if (rand() < 0.6) {
        const at = addMin(firstResponseAt, between(60, 600));
        if (at < (resolvedAt ?? now)) {
          comments.push({ ticketId: t.id, authorId: requester.id, body: pick(CUSTOMER_REPLIES), isInternal: false, createdAt: at });
          history.push({ ticketId: t.id, actorId: requester.id, action: 'COMMENT_ADDED', createdAt: at });
        }
      }
    }
    if (status === 'PENDING_CUSTOMER' && assigneeId) {
      history.push({ ticketId: t.id, actorId: assigneeId, action: 'STATUS_CHANGED', field: 'status', oldValue: 'IN_PROGRESS', newValue: 'PENDING_CUSTOMER', createdAt: t.slaPausedAt! });
    }
    if (status === 'ESCALATED') {
      history.push({ ticketId: t.id, actorId: managers[0].id, action: 'ESCALATED', field: 'escalationLevel', oldValue: '0', newValue: '1', isInternal: true, createdAt: t.escalatedAt!, metadata: { reason: 'Customer impact increasing' } });
      history.push({ ticketId: t.id, actorId: managers[0].id, action: 'STATUS_CHANGED', field: 'status', oldValue: 'IN_PROGRESS', newValue: 'ESCALATED', createdAt: t.escalatedAt! });
    }
    if (frBreached) history.push({ ticketId: t.id, actorId: null, action: 'SLA_BREACHED', field: 'firstResponse', isInternal: true, createdAt: frBreached });
    if (resBreached) history.push({ ticketId: t.id, actorId: null, action: 'SLA_BREACHED', field: 'resolution', isInternal: true, createdAt: resBreached });
    if (resolvedAt && assigneeId) {
      comments.push({ ticketId: t.id, authorId: assigneeId, body: `Resolution: ${t.resolutionNotes}`, isInternal: false, createdAt: resolvedAt });
      history.push({ ticketId: t.id, actorId: assigneeId, action: 'STATUS_CHANGED', field: 'status', oldValue: 'IN_PROGRESS', newValue: 'RESOLVED', createdAt: resolvedAt });
      await prisma.timeEntry.create({ data: { ticketId: t.id, userId: assigneeId, minutes: between(10, 240), note: 'Investigation and fix', workDate: resolvedAt, createdAt: resolvedAt } });
    }
    if (safeClosed) {
      history.push({ ticketId: t.id, actorId: null, action: 'STATUS_CHANGED', field: 'status', oldValue: 'RESOLVED', newValue: 'CLOSED', createdAt: safeClosed, metadata: { automatic: true } });
      if (rand() < 0.6 && !sub.internal) {
        const rating = weighted([[5, 5], [4, 3], [3, 1.2], [2, 0.5], [1, 0.3]]);
        await prisma.customerFeedback.create({
          data: { ticketId: t.id, requesterId: requester.id, rating, comment: rating >= 4 ? 'Quick and helpful, thank you.' : rating === 3 ? 'Resolved, but took a while.' : 'Had to follow up several times.', createdAt: addMin(safeClosed, 30) },
        });
        history.push({ ticketId: t.id, actorId: requester.id, action: 'FEEDBACK_SUBMITTED', newValue: String(rating), createdAt: addMin(safeClosed, 30) });
      }
    }
    await prisma.ticketComment.createMany({ data: comments });
    await prisma.ticketHistory.createMany({ data: history.filter((h) => (h.createdAt as Date) <= now) });
  }
  for (const [year, last] of yearSeq) {
    await prisma.ticketCounter.upsert({ where: { scope: `TKT:${year}` }, create: { scope: `TKT:${year}`, lastValue: last }, update: { lastValue: last } });
  }
  // A few notifications so the bell isn't empty
  const sam = agents[0].id;
  const recent = await prisma.ticket.findMany({ where: { assigneeId: sam }, orderBy: { createdAt: 'desc' }, take: 3 });
  await prisma.notification.createMany({
    data: recent.map((t) => ({ userId: sam, type: 'TICKET_ASSIGNED' as const, title: `Ticket ${t.number} assigned to you`, body: t.subject, ticketId: t.id })),
  });
  console.log(`Seeded ${N} tickets, ${customers.length} customers, ${agents.length} agents, ${managers.length} managers, 1 admin.`);
  console.log(`\n  DEVELOPMENT-ONLY credentials (password for all: ${DEV_PASSWORD})`);
  console.log('    Super Admin      admin@example.com');
  console.log('    Support Manager  manager@example.com');
  console.log('    Support Agent    agent@example.com');
  console.log('    Customer         customer@example.com\n');
}

async function main() {
  await syncReferenceData();
  if (process.env.NODE_ENV === 'production') {
    await seedProductionAdmin();
  } else {
    await seedDevelopmentData();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
