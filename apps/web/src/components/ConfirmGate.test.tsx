import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmGate } from './ConfirmGate';
import { setUpComponentTests } from './test-utils';

setUpComponentTests();

function renderGate(confirmName: string | null = 'dark_mode') {
  const onConfirm = vi.fn();
  render(
    <ConfirmGate
      sentence="Promote dark_mode from Staging to Production: 855 identities turn ON."
      targetName="Production"
      confirmName={confirmName}
      actionLabel="Apply to Production"
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, apply: screen.getByRole('button', { name: 'Apply to Production' }) };
}

describe('ConfirmGate', () => {
  it('restates the change and asks for the flag name', () => {
    renderGate();
    expect(screen.getByText(/855 identities turn ON/)).toBeTruthy();
    expect(screen.getByLabelText('Type dark_mode to apply to Production')).toBeTruthy();
  });

  it('keeps Apply disabled until the typed name matches exactly', () => {
    const { onConfirm, apply } = renderGate();
    const input = screen.getByLabelText('Type dark_mode to apply to Production');
    for (const typed of ['', 'dark_mod', 'Dark_mode', 'dark_mode ', ' dark_mode']) {
      fireEvent.change(input, { target: { value: typed } });
      expect(apply.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(apply);
      fireEvent.submit(apply);
    }
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getAllByText('Type dark_mode exactly to enable this button.').length).toBe(2);

    fireEvent.change(input, { target: { value: 'dark_mode' } });
    expect(apply.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('needs no typed name outside production', () => {
    const { onConfirm, apply } = renderGate(null);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Apply while the change is being applied', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmGate
        sentence="Promote dark_mode."
        targetName="Production"
        confirmName={null}
        actionLabel="Apply to Production"
        onConfirm={onConfirm}
        busy
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Production' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('replaces the gate with the blocking reasons', () => {
    render(
      <ConfirmGate
        sentence="Promote dark_mode."
        targetName="Production"
        confirmName="dark_mode"
        actionLabel="Apply to Production"
        onConfirm={vi.fn()}
        blockers={['Dependencies differ.']}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('This change cannot be applied to Production')).toBeTruthy();
    expect(screen.getByText('Dependencies differ.')).toBeTruthy();
  });
});
