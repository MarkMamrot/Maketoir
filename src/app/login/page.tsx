"use client";

import { useState } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-3xl font-extrabold text-blue-600 mb-2 text-center">Solvantis</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">Sign in to your workspace</p>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              className="w-full p-2 border border-gray-300 rounded mt-1" 
              required 
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="w-full p-2 border border-gray-300 rounded mt-1" 
              required 
            />
          </div>

          <button type="submit" disabled={loading} className="w-full py-3 mt-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        {result && (
          <div className={`mt-4 p-4 w-full rounded-md text-sm font-mono overflow-auto ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <pre className="whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
            {result.success && (
              <div className="mt-4">
                <Link href="/dashboard">
                  <button className="w-full py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">
                    Go to Main Dashboard
                  </button>
                </Link>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Don't have an account? <Link href="/" className="text-blue-600 hover:underline font-bold">Register Now</Link></p>
        </div>
      </div>
    </main>
  );
}
