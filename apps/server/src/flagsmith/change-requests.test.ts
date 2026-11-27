import { describe, expect, it } from 'vitest';
import { changeRequestsBlockWrites } from './change-requests.js';

describe('changeRequestsBlockWrites', () => {
  it('allows writes only when minimum_change_request_approvals is null', () => {
    expect(changeRequestsBlockWrites({ minimum_change_request_approvals: null })).toBe(false);
  });

  it.each([0, 1, 3])(
    'blocks writes when minimum_change_request_approvals is %i, 0 included',
    (n) => {
      expect(changeRequestsBlockWrites({ minimum_change_request_approvals: n })).toBe(true);
    },
  );
});
