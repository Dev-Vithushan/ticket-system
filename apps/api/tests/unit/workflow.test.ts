import { describe, expect, it } from 'vitest';
import { transitionError, TRANSITIONS } from '../../src/modules/tickets/workflow';

describe('ticket workflow', () => {
  it('allows a normal lifecycle', () => {
    expect(transitionError({ from: 'ASSIGNED', to: 'IN_PROGRESS', hasAssignee: true })).toBeNull();
    expect(transitionError({ from: 'IN_PROGRESS', to: 'PENDING_CUSTOMER', hasAssignee: true })).toBeNull();
    expect(transitionError({ from: 'PENDING_CUSTOMER', to: 'IN_PROGRESS', hasAssignee: true })).toBeNull();
    expect(transitionError({ from: 'IN_PROGRESS', to: 'RESOLVED', hasAssignee: true, resolutionNotes: 'Fixed' })).toBeNull();
    expect(transitionError({ from: 'RESOLVED', to: 'CLOSED', hasAssignee: true })).toBeNull();
  });

  it('rejects transitions outside the workflow', () => {
    expect(transitionError({ from: 'CLOSED', to: 'IN_PROGRESS', hasAssignee: true })).toMatch(/Cannot change status/);
    expect(transitionError({ from: 'RESOLVED', to: 'IN_PROGRESS', hasAssignee: true })).toMatch(/Cannot change status/);
    expect(transitionError({ from: 'OPEN', to: 'OPEN', hasAssignee: false })).toMatch(/already/);
  });

  it('requires an assignee for ASSIGNED and IN_PROGRESS', () => {
    expect(transitionError({ from: 'OPEN', to: 'IN_PROGRESS', hasAssignee: false })).toMatch(/assignee/);
    expect(transitionError({ from: 'OPEN', to: 'ASSIGNED', hasAssignee: false })).toMatch(/assignee/);
  });

  it('requires resolution notes to resolve or close an unresolved ticket', () => {
    expect(transitionError({ from: 'IN_PROGRESS', to: 'RESOLVED', hasAssignee: true })).toMatch(/Resolution notes/);
    expect(transitionError({ from: 'OPEN', to: 'CLOSED', hasAssignee: false, resolutionNotes: '  ' })).toMatch(/Resolution notes/);
    expect(transitionError({ from: 'OPEN', to: 'CLOSED', hasAssignee: false, resolutionNotes: 'Duplicate' })).toBeNull();
  });

  it('never allows leaving CLOSED through a status change', () => {
    expect(TRANSITIONS.CLOSED).toEqual([]);
  });
});
