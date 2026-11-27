import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serveFlags } from '../../test/flagsmith';
import { useTheme } from './useTheme';

vi.mock('@flagsmith/flagsmith/react', async () => (await import('../../test/flagsmith')).reactModule);

describe('useTheme', () => {
  it('gives users in the dark-mode rollout the dark theme', () => {
    serveFlags({ dark_mode: { enabled: true } });

    expect(renderHook(() => useTheme()).result.current).toBe('dark');
  });
});
