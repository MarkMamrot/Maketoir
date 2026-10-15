import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn(), hash: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: vi.fn(), execute: mocks.execute }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
import { UsersRepository } from '../UsersRepository';
import { PasswordPolicyValidationError } from '@/lib/auth/passwordPolicy';

beforeEach(() => {
  vi.clearAllMocks(); mocks.execute.mockResolvedValue({ insertId: 42 }); mocks.hash.mockResolvedValue('secure-hash');
});

describe('central named-user password creation', () => {
  it('validates before hashing or storing and stamps known password age', async () => {
    expect(await UsersRepository.create({ email: 'PERSON@example.com', password: 'FreshReset9!' })).toBe(42);
    expect(mocks.hash).toHaveBeenCalledWith('FreshReset9!', 12);
    expect(mocks.execute.mock.calls[0][1][0]).toBe('person@example.com');
    expect(mocks.execute.mock.calls[0][1][9]).toBeInstanceOf(Date);
  });

  it('leaves inaccessible setup credentials undated so they cannot complete sign-in', async () => {
    await UsersRepository.create({ email: 'person@example.com', password: 'FreshReset9!', requirePasswordSetup: true });
    expect(mocks.execute.mock.calls[0][1][9]).toBeNull();
  });

  it.each([
    { password: 'short' },
    { password: 'FreshMORGAN9!', name: 'Morgan Person' },
    { password: 'X9!person@example.com', username: 'different' },
  ])('does not allow a creation route to bypass shared validation', async data => {
    await expect(UsersRepository.create({ email: 'person@example.com', ...data })).rejects.toBeInstanceOf(PasswordPolicyValidationError);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
