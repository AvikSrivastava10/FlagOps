import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { useFeature } from './useFeature';

vi.mock('@flagsmith/flagsmith/react', async () => (await import('../../test/flagsmith')).reactModule);

describe('useFeature', () => {
  it("returns whether Flagsmith serves the flag's on state", () => {
    serveFlags({ holiday_banner: { enabled: true } });
    expect(renderHook(() => useFeature('holiday_banner')).result.current).toBe(true);

    serveFlags({ holiday_banner: { enabled: false } });
    expect(renderHook(() => useFeature('holiday_banner')).result.current).toBe(false);
  });
});
