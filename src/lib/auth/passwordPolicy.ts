export const PASSWORD_REQUIREMENTS = [
  {
    id: 'length',
    label: 'At least 12 characters',
    test: (password: string) => password.length >= 12,
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'number',
    label: 'One number',
    test: (password: string) => /\d/.test(password),
  },
  {
    id: 'special',
    label: 'One special character',
    test: (password: string) => /[^A-Za-z0-9]/.test(password),
  },
] as const;

export function getPasswordValidation(password: string) {
  const failedRequirements = PASSWORD_REQUIREMENTS.filter(requirement => !requirement.test(password));

  return {
    isValid: failedRequirements.length === 0,
    failedRequirements,
    message: failedRequirements.length
      ? `Password must include: ${failedRequirements.map(requirement => requirement.label.toLowerCase()).join(', ')}.`
      : '',
  };
}