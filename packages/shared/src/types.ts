export const SERIOUSNESS = ['need', 'really_want', 'nice_to_have'] as const;
export type Seriousness = (typeof SERIOUSNESS)[number];

export const STATUSES = [
  'pending',
  'approved',
  'delayed',
  'awaiting_reconfirm',
  'denied',
  'cancelled',
  'archived',
  'purchased',
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const ACTIONS = ['approve', 'delay', 'deny'] as const;
export type ApproverAction = (typeof ACTIONS)[number];

export const APPEAL_PERIODS = ['monthly', 'quarterly'] as const;
export type AppealPeriod = (typeof APPEAL_PERIODS)[number];

export const APPEAL_STATUSES = ['pending', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

// The subset of statuses considered "active" — not terminated (cancelled/archived/purchased).
// Used by the queue endpoint and any UI that filters out completed requests.
export const ACTIVE_STATUSES = ['pending', 'delayed', 'awaiting_reconfirm', 'approved', 'denied'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
