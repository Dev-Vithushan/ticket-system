import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../lib/types';
import { PERMISSIONS } from '../auth/permissions';

/**
 * Row-level access rule for tickets — the single source of truth used by lists, detail views,
 * actions, attachments and reports.
 *  - ticket.view_all  → every ticket
 *  - ticket.view_team → tickets of the user's teams, tickets assigned to them, and their own requests
 *  - otherwise        → only tickets the user requested
 */
export function ticketScope(auth: AuthContext): Prisma.TicketWhereInput {
  if (auth.can(PERMISSIONS.TICKET_VIEW_ALL)) return {};
  if (auth.can(PERMISSIONS.TICKET_VIEW_TEAM)) {
    return {
      OR: [
        ...(auth.teamIds.length ? [{ teamId: { in: auth.teamIds } }] : []),
        { assigneeId: auth.user.id },
        { requesterId: auth.user.id },
      ],
    };
  }
  return { requesterId: auth.user.id };
}

export const canSeeInternal = (auth: AuthContext) => auth.can(PERMISSIONS.TICKET_INTERNAL_NOTES);

/** Staff acting on a ticket they can see (not merely as its requester). */
export function isStaffOnTicket(auth: AuthContext, ticket: { requesterId: string }) {
  return auth.user.isStaff && !(ticket.requesterId === auth.user.id && !canSeeInternal(auth));
}
