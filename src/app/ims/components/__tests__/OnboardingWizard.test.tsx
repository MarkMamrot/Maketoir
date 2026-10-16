/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard } from '../OnboardingWizard';

afterEach(cleanup);

function setup(actionStep = false) {
  const props = {
    open: true,
    onboarding: {
      complete: false,
      steps: [
        { id: actionStep ? 'users' : 'business_profile', title: actionStep ? 'Add additional users' : 'Business identity', completed: false, autoCompleted: false },
        { id: 'operations', title: 'Operations', completed: false, autoCompleted: false },
      ],
    },
    draft: { business_name: 'Example Store', business_phone: '0212345678' },
    saving: false,
    xeroAccountingEnabled: false,
    onClose: vi.fn(),
    onFieldChange: vi.fn(),
    onSaveStep: vi.fn().mockResolvedValue(undefined),
    onCompleteStep: vi.fn().mockResolvedValue(undefined),
    onAction: vi.fn(),
  };
  render(<OnboardingWizard {...props} />);
  return props;
}

describe('Business setup save errors', () => {
  it('keeps identity open and shows the save failure, then allows a successful retry', async () => {
    const props = setup();
    props.onSaveStep.mockRejectedValueOnce(new Error('Business setup could not be saved. Please retry this step.'));
    await userEvent.click(screen.getByRole('button', { name: 'Save and next' }));
    expect(screen.getByRole('alert').textContent).toContain('Please retry');
    expect(screen.getByRole('heading', { name: 'Business identity' })).toBeTruthy();
    expect(screen.getByText('0 of 2 complete')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Save and next' }));
    expect(props.onSaveStep).toHaveBeenLastCalledWith('business_profile', expect.objectContaining({
      business_name: 'Example Store', business_phone: '0212345678',
    }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Operations' })).toBeTruthy();
  });

  it('does not advance an action step when marking it complete fails', async () => {
    const props = setup(true);
    props.onCompleteStep.mockRejectedValueOnce(new Error('Progress could not be saved.'));
    await userEvent.click(screen.getByRole('button', { name: 'Mark done and continue' }));
    expect(screen.getByRole('alert').textContent).toBe('Progress could not be saved.');
    expect(screen.getByRole('heading', { name: 'Bring your team in' })).toBeTruthy();
    expect(props.onCompleteStep).toHaveBeenCalledWith('users');
  });
});
