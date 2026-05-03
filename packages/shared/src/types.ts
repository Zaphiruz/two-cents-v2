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
