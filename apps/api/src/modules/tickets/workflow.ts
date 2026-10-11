import type { TicketStatus } from '@prisma/client';

export const STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'];
export const ACTIVE_STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED'];
export const DONE_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/**
 * Allowed manual status transitions. Reopening (RESOLVED/CLOSED → active) is a dedicated action
 * with its own eligibility rules, and escalation goes through the escalate action.
 */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['OPEN', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['ASSIGNED', 'PENDING_CUSTOMER', 'ESCALATED', 'RESOLVED'],
  PENDING_CUSTOMER: ['IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CUSTOMER', 'RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export interface TransitionInput {
  from: TicketStatus;
  to: TicketStatus;
  hasAssignee: boolean;
  resolutionNotes?: string | null;
}

/** Returns an error message when the transition is not allowed, otherwise null. */
export function transitionError({ from, to, hasAssignee, resolutionNotes }: TransitionInput): string | null {
  if (from === to) return `Ticket is already ${to}`;
  if (!TRANSITIONS[from].includes(to)) return `Cannot change status from ${from} to ${to}`;
  if ((to === 'ASSIGNED' || to === 'IN_PROGRESS') && !hasAssignee) return `A ticket must have an assignee to be ${to}`;
  if (to === 'OPEN' && hasAssignee) return 'Unassign the ticket to move it back to OPEN';
  if ((to === 'RESOLVED' || (to === 'CLOSED' && from !== 'RESOLVED')) && !resolutionNotes?.trim()) {
    return 'Resolution notes are required to resolve or close a ticket';
  }
  return null;
}

export const isActive = (s: TicketStatus) => ACTIVE_STATUSES.includes(s);
