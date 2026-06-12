'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BusinessInfo() {
  const [brandName, setBrandName] = useState('');
  const [brandUrl, setBrandUrl] = useState('');
  const [yearsInBusiness, setYearsInBusiness] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [pinterestUrl, setPinterestUrl] = useState('');
  const [abn, setAbn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/user/business-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brandName, brandUrl, yearsInBusiness, facebookUrl, instagramUrl, pinterestUrl, abn }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(data.message || 'Information saved successfully!');
        // Could optionally redirect to dashboard here:
        // router.push('/dashboard');
      } else {
        setError(data.error || 'Got an error from server.');
      }
    } catch (err: any) {
      setError('An unexpected error occurred building the request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gray-50 flex items-center justify-center p-4">
      {/* Absolute Header Navigation */}
      <div className="absolute top-4 left-4">
        <button
          onClick={() => router.push('/dashboard')}
          className="px-4 py-2 border rounded shadow-md font-semibold bg-white text-gray-700 hover:bg-gray-100"
        >
          &larr; Back to Dashboard
        </button>
      </div>

      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md mt-16">
        <h2 className="text-2xl font-bold text-gray-800 text-center mb-6">Enter Business Key Information</h2>

        {error && <p className="mb-4 text-sm text-red-600 font-semibold">{error}</p>}
        {success && <p className="mb-4 text-sm text-green-600 font-semibold">{success}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="Your Brand"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand URL</label>
            <input
              type="url"
              value={brandUrl}
              onChange={(e) => setBrandUrl(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="https://yourbrand.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Years in Business</label>
            <input
              type="number"
              min="0"
              value={yearsInBusiness}
              onChange={(e) => setYearsInBusiness(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="e.g. 3"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Link (Optional)</label>
            <input
              type="url"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="https://facebook.com/yourbrand"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Instagram Link (Optional)</label>
            <input
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="https://instagram.com/yourbrand"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pinterest Link (Optional)</label>
            <input
              type="url"
              value={pinterestUrl}
              onChange={(e) => setPinterestUrl(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="https://pinterest.com/yourbrand"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ABN (Optional)</label>
            <input
              type="text"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              placeholder="e.g. 11 222 333 444"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2 px-4 rounded font-semibold text-white ${
              loading ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {loading ? 'Saving...' : 'Save Business Information'}
          </button>
        </form>
      </div>
    </div>
  );
}
