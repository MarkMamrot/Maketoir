'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PASSWORD_REQUIREMENTS, getPasswordValidation } from '@/lib/auth/passwordPolicy';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const passwordValidation = getPasswordValidation(form.password);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!passwordValidation.isValid) {
      setError(passwordValidation.message);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Registration failed.');
      } else {
        router.push('/login?registered=1');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error.');
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-3xl font-extrabold text-blue-600 mb-1 text-center">Solvantis</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">Create your business workspace</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Company Name *</label>
            <input type="text" value={form.company} onChange={set('company')} required
              className="w-full p-2 border border-gray-300 rounded mt-1" placeholder="Acme Pty Ltd" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Your Name</label>
            <input type="text" value={form.name} onChange={set('name')}
              className="w-full p-2 border border-gray-300 rounded mt-1" placeholder="Jane Smith" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Email Address *</label>
            <input type="email" value={form.email} onChange={set('email')} required
              className="w-full p-2 border border-gray-300 rounded mt-1" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Phone</label>
            <input type="tel" value={form.phone} onChange={set('phone')}
              className="w-full p-2 border border-gray-300 rounded mt-1" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Password *</label>
            <input type="password" value={form.password} onChange={set('password')} required minLength={12} autoComplete="new-password" aria-describedby="password-requirements"
              className="w-full p-2 border border-gray-300 rounded mt-1" />
            <ul id="password-requirements" className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-2">
              {PASSWORD_REQUIREMENTS.map(requirement => {
                const met = requirement.test(form.password);
                return (
                  <li key={requirement.id} className={met ? 'text-green-700' : 'text-gray-500'}>
                    {met ? '[x]' : '[ ]'} {requirement.label}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Confirm Password *</label>
            <input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password"
              className="w-full p-2 border border-gray-300 rounded mt-1" />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Creating workspace...' : 'Create Business Account'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>Already have an account? <Link href="/login" className="text-blue-600 hover:underline font-bold">Sign In</Link></p>
        </div>
      </div>
    </main>
  );
}
