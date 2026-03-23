// src/app/page.tsx
export default function Home() {
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

      <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-6 w-full max-w-5xl">
        <div className="p-6 bg-white shadow-lg rounded-xl flex flex-col justify-between">
          <h2 className="text-xl font-bold mb-4">Integrations</h2>
          <ul className="space-y-2 text-sm text-gray-700 font-medium">
            <li>✅ Google Sheets DB</li>
            <li>✅ Shopify API</li>
            <li>✅ Meta Ads API</li>
            <li>✅ Google Ads API</li>
          </ul>
        </div>
        <div className="p-6 bg-white shadow-lg rounded-xl flex flex-col justify-between opacity-50">
          <h2 className="text-xl font-bold mb-4">"Brain Sync" (Phase 2)</h2>
          <p className="text-xs text-gray-500">Live API Mapping and Groq/Gemini Brand DNA coming soon.</p>
        </div>
        <div className="p-6 bg-white shadow-lg rounded-xl flex flex-col justify-between opacity-50">
          <h2 className="text-xl font-bold mb-4">Creative Sandbox (Phase 3)</h2>
          <p className="text-xs text-gray-500">Vision-capable AI Auto-Tagging and Meta/Google multi-deployment.</p>
        </div>
        <div className="p-6 bg-white shadow-lg rounded-xl flex flex-col justify-between opacity-50">
          <h2 className="text-xl font-bold mb-4">Feedback Loop (Phase 4)</h2>
          <p className="text-xs text-gray-500">Scaling winners, pausing losers, ROAS optimizations.</p>
        </div>
      </div>
    </main>
  );
}
