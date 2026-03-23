// src/app/page.tsx
"use client";

import { useState } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [folderId, setFolderId] = useState('');

  const testDatabaseInit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/database/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceName: 'Acme Corp Test',
          folderId: folderId || undefined
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-50">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex border-b border-gray-300 pb-6 mb-12">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-blue-600">
          Marketoir Dashboard
        </h1>
        <div className="text-right">
          <p className="text-gray-500">Phase 1: The Data Foundation</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-6 w-full max-w-5xl mb-12">
        <div className="p-6 bg-white shadow-lg rounded-xl flex flex-col justify-between">
          <h2 className="text-xl font-bold mb-4 text-black">Integrations</h2>
          <ul className="space-y-2 text-sm text-gray-700 font-medium">
            <li>✅ Google Sheets DB</li>
            <li>✅ Shopify API</li>
            <li>✅ Meta Ads API</li>
            <li>✅ Google Ads API</li>
          </ul>
        </div>
      </div>

      {/* TEST SECTION */}
      <div className="w-full max-w-5xl p-6 bg-white shadow-lg rounded-xl border border-blue-100 flex flex-col items-start">
        <h2 className="text-xl font-bold mb-2 text-black">Workspace Setup Test</h2>
        <p className="text-sm text-gray-600 mb-4">
          Provide your Google Drive Folder ID below to create the database spreadsheet specifically in that folder.
        </p>

        <input 
          type="text" 
          placeholder="Paste Folder ID here (Optional but recommended)"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="w-full max-w-md p-2 border border-gray-300 rounded mb-4 text-black"
        />

        <button
          onClick={testDatabaseInit}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Creating Database...' : 'Create Test Workspace Database'}
        </button>

        {result && (
          <div className={`mt-4 p-4 w-full rounded-md text-sm font-mono overflow-auto ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <pre>{JSON.stringify(result, null, 2)}</pre>
            {result.spreadsheetId && (
              <a 
                href={`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`} 
                target="_blank" 
                rel="noreferrer"
                className="mt-2 inline-block text-blue-600 underline font-bold"
              >
                Click here to view your new database!
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
