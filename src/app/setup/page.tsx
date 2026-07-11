'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type UISkin = 'dark' | 'default';
const UI_SKIN_STORAGE_KEY = 'solvantis_ui_skin';

function applyUISkin(skin: UISkin) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-skin', skin);
  }
}

export function AppearanceTab() {
  const [skin, setSkin] = useState<UISkin>('dark');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(UI_SKIN_STORAGE_KEY);
      const resolved = stored === 'default' ? 'default' : 'dark';
      setSkin(resolved);
      applyUISkin(resolved);
    } catch {
      setSkin('dark');
      applyUISkin('dark');
    }
  }, []);

  const chooseSkin = (next: UISkin) => {
    setSkin(next);
    applyUISkin(next);
    setNotice('');
  };

  const saveSkin = () => {
    try {
      localStorage.setItem(UI_SKIN_STORAGE_KEY, skin);
      setNotice(`Saved. ${skin === 'dark' ? 'Dark' : 'Default'} skin is now your preference.`);
    } catch {
      setNotice('Could not save this preference in your browser.');
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-100 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Appearance</h2>
        <p className="text-sm text-gray-500">Choose the Solvantis interface skin used across the app.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => chooseSkin('dark')}
          className={`text-left p-4 rounded-xl border transition-colors ${skin === 'dark' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-800">Dark</span>
            {skin === 'dark' && <span className="text-xs font-semibold text-blue-700">Active</span>}
          </div>
          <p className="text-xs text-gray-500 mb-3">Operational High-Performance. Calm, Exact, Strategic.</p>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="h-6 bg-gray-900 border-b border-gray-700" />
            <div className="h-12 bg-gray-800" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => chooseSkin('default')}
          className={`text-left p-4 rounded-xl border transition-colors ${skin === 'default' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-800">Default</span>
            {skin === 'default' && <span className="text-xs font-semibold text-blue-700">Active</span>}
          </div>
          <p className="text-xs text-gray-500 mb-3">Strategic Blueprint. Calm, Intelligent, Unified.</p>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="h-6 bg-gray-100 border-b border-gray-200" />
            <div className="h-12 bg-white" />
          </div>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={saveSkin}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
        >
          Save Appearance
        </button>
        {notice && <span className="text-xs text-gray-500">{notice}</span>}
      </div>
    </div>
  );
}

// --- Embedded Business Info Component ---
export function BusinessInfoTab({ business }: { business: { name: string; userId: string; databaseId: string } | null }) {
  const [brandName, setBrandName] = useState('');
  const [brandUrl, setBrandUrl] = useState('');
  const [yearsInBusiness, setYearsInBusiness] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [pinterestUrl, setPinterestUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!business?.databaseId) return;
    setFetching(true);
    setBrandName(''); setBrandUrl(''); setYearsInBusiness('');
    setFacebookUrl(''); setInstagramUrl(''); setPinterestUrl('');
    setSuccess(''); setError('');
    const databaseId = business.databaseId;
    async function loadData() {
      try {
        const res = await fetch(`/api/user/business-info?databaseId=${encodeURIComponent(databaseId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.brandName) setBrandName(data.brandName);
          if (data.brandUrl) setBrandUrl(data.brandUrl);
          if (data.yearsInBusiness) setYearsInBusiness(data.yearsInBusiness);
          if (data.facebookUrl) setFacebookUrl(data.facebookUrl);
          if (data.instagramUrl) setInstagramUrl(data.instagramUrl);
          if (data.pinterestUrl) setPinterestUrl(data.pinterestUrl);
        }
      } catch (err) {
        console.error('Failed to load business info', err);
      } finally {
        setFetching(false);
      }
    }
    loadData();
  }, [business?.databaseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/user/business-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: business?.databaseId, brandName, brandUrl, yearsInBusiness, facebookUrl, instagramUrl, pinterestUrl }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(data.message || 'Information saved successfully!');
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
    <div className="w-full max-w-lg mx-auto bg-white p-8 rounded-lg shadow-sm border border-gray-100"> 
      <h2 className="text-2xl font-bold text-gray-800 text-center mb-6">Enter Business Key Information</h2>

      {fetching ? (
        <div className="text-center py-10 text-gray-500">Loading existing information...</div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// --- Brand Colour Palette helpers ---
const COLOUR_ROLES = [
  { key: 'primary',    label: 'Primary',    desc: 'Main brand colour — logo, buttons, headings' },
  { key: 'secondary',  label: 'Secondary',  desc: 'Supporting / complementary colour' },
  { key: 'accent',     label: 'Accent',     desc: 'CTAs, highlights, links' },
  { key: 'neutral',    label: 'Neutral',    desc: 'Text, borders, muted elements' },
  { key: 'background', label: 'Background', desc: 'Page / surface background' },
] as const;

type ColourRole = typeof COLOUR_ROLES[number]['key'];
type ColourPalette = Record<ColourRole, string>;

const EMPTY_PALETTE: ColourPalette = { primary: '', secondary: '', accent: '', neutral: '', background: '' };

function parsePalette(json: string): ColourPalette {
  if (!json) return { ...EMPTY_PALETTE };
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...EMPTY_PALETTE, ...parsed };
    }
    // Legacy: comma-separated string was stored as JSON string
    if (typeof parsed === 'string') {
      const arr = parsed.split(',').map((s: string) => s.trim());
      const obj = { ...EMPTY_PALETTE } as Record<string, string>;
      COLOUR_ROLES.forEach(({ key }, i) => { obj[key] = arr[i] ?? ''; });
      return obj as ColourPalette;
    }
  } catch {
    // Fallback: plain comma-separated (not valid JSON)
    const arr = json.split(',').map(s => s.trim());
    const obj = { ...EMPTY_PALETTE } as Record<string, string>;
    COLOUR_ROLES.forEach(({ key }, i) => { obj[key] = arr[i] ?? ''; });
    return obj as ColourPalette;
  }
  return { ...EMPTY_PALETTE };
}

// Convert any Google Drive URL to the thumbnail variant that works as <img src>
function drivePreviewUrl(url: string): string {
  const ucMatch = url.match(/[?&]id=([^&]+)/);
  if (ucMatch && url.includes('drive.google.com')) {
    return `https://drive.google.com/thumbnail?id=${ucMatch[1]}&sz=w800`;
  }
  return url;
}

// --- Embedded AI Brand Profile Builder Component ---
export function BrandProfileTab({ business }: { business: { name: string; userId: string; databaseId: string } | null }) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiRefining, setAiRefining] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refineComments, setRefineComments] = useState('');
  const [regeneratingField, setRegeneratingField] = useState<string | null>(null);

  // Logo state
  const [logoPreview, setLogoPreview] = useState<string | null>(null); // base64 data URL for preview
  const [logoBase64, setLogoBase64] = useState<string | null>(null);   // raw base64 (no data: prefix) for API
  const [logoMimeType, setLogoMimeType] = useState<string>('image/jpeg');

  const [formData, setFormData] = useState({
    mission: '', uvp: '', tone: '', demographics: '', geo: '',
    products: '', pricing: '', praises: '', objections: '',
    competitors: '', marketGap: '',
    shippingPolicy: '',
    returnsPolicy: '',
    connectedSoftware: '',
    brandHistory: '',
    detailedBrandAesthetic: '',
    physicalBranches: [{ name: '', address: '', phone: '', email: '', openingHours: '' }],
    loyaltyProgram: '',
    operationsSummary: '',
    logoUrl: '',
    brandColours: '', // comma-separated HEX codes stored as string
  });

  // Derived: colour palette from formData.brandColours JSON string
  const palette = parsePalette(formData.brandColours);

  const updateColour = (role: ColourRole, hex: string) => {
    const updated = { ...palette, [role]: hex };
    setFormData(f => ({ ...f, brandColours: JSON.stringify(updated) }));
  };

  useEffect(() => {
    if (!business?.databaseId) return;
    setFetching(true);
    setFormData({ mission: '', uvp: '', tone: '', demographics: '', geo: '', products: '', pricing: '', praises: '', objections: '', competitors: '', marketGap: '', shippingPolicy: '', returnsPolicy: '', connectedSoftware: '', brandHistory: '', detailedBrandAesthetic: '', physicalBranches: [{ name: '', address: '', phone: '', email: '', openingHours: '' }], loyaltyProgram: '', operationsSummary: '', logoUrl: '', brandColours: '' });
    setLogoPreview(null); setLogoBase64(null);
    setSuccess(''); setError('');
    const databaseId = business.databaseId;
    async function loadData() {
      try {
        const res = await fetch(`/api/user/brand-profile?databaseId=${encodeURIComponent(databaseId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.mission) {
            setFormData({
              mission: data.mission || '', uvp: data.uvp || '', tone: data.tone || '',
              demographics: data.demographics || '', geo: data.geo || '',
              products: data.products || '', pricing: data.pricing || '',
              praises: data.praises || '', objections: data.objections || '',
              competitors: data.competitors || '', marketGap: data.marketGap || '',
              shippingPolicy: data.shippingPolicy || '',
              returnsPolicy: data.returnsPolicy || '',
              connectedSoftware: data.connectedSoftware || '',
              brandHistory: data.brandHistory || '',
              detailedBrandAesthetic: data.detailedBrandAesthetic || '',
              physicalBranches: Array.isArray(data.physicalBranches) ? data.physicalBranches : [{ name: '', address: '', phone: '', email: '', openingHours: '' }],
              loyaltyProgram: data.loyaltyProgram || '',
              operationsSummary: data.operationsSummary || '',
              logoUrl: data.logoUrl || '', brandColours: data.brandColours || '',
            });
            if (data.logoUrl) setLogoPreview(drivePreviewUrl(data.logoUrl));
          }
        }
      } catch (err) {
        console.error('Failed to load brand profile', err);
      } finally {
        setFetching(false);
      }
    }
    loadData();
  }, [business?.databaseId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  /** Handle logo file upload — read as base64 for preview + API */
  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setLogoPreview(dataUrl);
      // Strip the data:image/...;base64, prefix for the API
      const base64 = dataUrl.split(',')[1] ?? '';
      setLogoBase64(base64);
      setLogoMimeType(file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
  };

  const handleRegenerateField = async (fieldKey: string) => {
    if (!business?.databaseId) return;
    setRegeneratingField(fieldKey);
    setError('');
    try {
      const infoRes = await fetch(`/api/user/business-info?databaseId=${encodeURIComponent(business.databaseId)}`);
      let brandName = business?.name || 'Unknown Brand';
      let brandUrl = '';
      if (infoRes.ok) { const d = await infoRes.json(); if (d.brandName) brandName = d.brandName; if (d.brandUrl) brandUrl = d.brandUrl; }
      const res = await fetch('/api/ai/build-brand-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate-field',
          fieldKey,
          brandName,
          brandUrl,
          databaseId: business.databaseId,
          existingProfile: { ...formData, brandColours: palette },
        }),
      });
      const data = await res.json();
      if (res.ok && data.profile && data.profile[fieldKey] !== undefined) {
        const val = data.profile[fieldKey];
         if (fieldKey === 'physicalBranches') {
           setFormData(f => ({ ...f, physicalBranches: Array.isArray(val) ? val : [{ name: '', address: '', phone: '', email: '', openingHours: '' }] }));
         } else {
           setFormData(f => ({ ...f, [fieldKey]: Array.isArray(val) ? val.join('\n') : (val || '') }));
         }
      } else {
        setError(data.error || `Failed to regenerate ${fieldKey}.`);
      }
    } catch {
      setError(`An error occurred regenerating ${fieldKey}.`);
    } finally {
      setRegeneratingField(null);
    }
  };

  const handleGenerateAI = async () => {
    setAiGenerating(true);
    setError('');
    setSuccess('');

    try {
      const infoRes = await fetch(`/api/user/business-info?databaseId=${encodeURIComponent(business?.databaseId || '')}`);
      let brandUrl = 'https://brand.com';
      let brandName = business?.name || 'Unknown Brand';

      if (infoRes.ok) {
        const infoData = await infoRes.json();
        if (infoData.brandUrl) brandUrl = infoData.brandUrl;
        if (infoData.brandName) brandName = infoData.brandName;
      }

      const response = await fetch('/api/ai/build-brand-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl, brandName,
          databaseId: business?.databaseId,
          logoBase64: logoBase64 ?? undefined,
          logoMimeType: logoBase64 ? logoMimeType : undefined,
        }),
      });

      const data = await response.json();
      if (response.ok && data.profile) {
        const p = data.profile;
        setFormData({
          mission: p.mission || '', uvp: p.uvp || '', tone: p.tone || '',
          demographics: p.demographics || '', geo: p.geo || '',
          products: Array.isArray(p.products) ? p.products.join('\n') : (p.products || ''),
          pricing: p.pricing || '',
          praises: Array.isArray(p.praises) ? p.praises.join('\n') : (p.praises || ''),
          objections: Array.isArray(p.objections) ? p.objections.join('\n') : (p.objections || ''),
          competitors: Array.isArray(p.competitors) ? p.competitors.join('\n') : (p.competitors || ''),
          marketGap: p.marketGap || '',
          shippingPolicy: p.shippingPolicy || '',
          returnsPolicy: p.returnsPolicy || '',
          connectedSoftware: p.connectedSoftware || '',
          brandHistory: p.brandHistory || '',
          detailedBrandAesthetic: Array.isArray(p.detailedBrandAesthetic) ? p.detailedBrandAesthetic.join('\n') : (p.detailedBrandAesthetic || ''),
           physicalBranches: Array.isArray(p.physicalBranches) ? p.physicalBranches : (p.physicalBranches ? [{ name: p.physicalBranches, address: '', phone: '', email: '', openingHours: '' }] : [{ name: '', address: '', phone: '', email: '', openingHours: '' }]),
          loyaltyProgram: p.loyaltyProgram || '',
          operationsSummary: formData.operationsSummary, // not AI-managed
          logoUrl: p.logoUrl || formData.logoUrl || '',
          brandColours: typeof p.brandColours === 'object' && p.brandColours !== null
            ? JSON.stringify({ ...EMPTY_PALETTE, ...p.brandColours })
            : (p.brandColours || ''),
        });
        // Show logo preview from auto-detected URL if no file uploaded
        if (!logoBase64 && p.logoUrl) setLogoPreview(drivePreviewUrl(p.logoUrl));
        setSuccess('AI profile generation complete! Review the fields below before saving.');
      } else {
        setError(data.error || 'Failed to generate profile via AI.');
      }
    } catch (err) {
      setError('An unexpected error occurred during AI generation.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleRefine = async () => {
    if (!refineComments.trim()) return;
    setAiRefining(true);
    setError('');
    setSuccess('');

    try {
      const infoRes = await fetch(`/api/user/business-info?databaseId=${encodeURIComponent(business?.databaseId || '')}`);
      let brandName = business?.name || 'Unknown Brand';
      if (infoRes.ok) {
        const infoData = await infoRes.json();
        if (infoData.brandName) brandName = infoData.brandName;
      }

      // Build current profile object to pass to AI
      const currentProfile = {
        ...formData,
        brandColours: palette, // send structured object, not JSON string
      };

      const response = await fetch('/api/ai/build-brand-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName,
          databaseId: business?.databaseId,
          mode: 'refine',
          existingProfile: currentProfile,
          userComments: refineComments,
          logoBase64: logoBase64 ?? undefined,
          logoMimeType: logoBase64 ? logoMimeType : undefined,
        }),
      });

      const data = await response.json();
      if (response.ok && data.profile) {
        const p = data.profile;
        setFormData({
          mission: p.mission || '', uvp: p.uvp || '', tone: p.tone || '',
          demographics: p.demographics || '', geo: p.geo || '',
          products: Array.isArray(p.products) ? p.products.join('\n') : (p.products || ''),
          pricing: p.pricing || '',
          praises: Array.isArray(p.praises) ? p.praises.join('\n') : (p.praises || ''),
          objections: Array.isArray(p.objections) ? p.objections.join('\n') : (p.objections || ''),
          competitors: Array.isArray(p.competitors) ? p.competitors.join('\n') : (p.competitors || ''),
          marketGap: p.marketGap || '',
          shippingPolicy: p.shippingPolicy || '',
          returnsPolicy: p.returnsPolicy || '',
          connectedSoftware: p.connectedSoftware || '',
          brandHistory: p.brandHistory || '',
          detailedBrandAesthetic: Array.isArray(p.detailedBrandAesthetic) ? p.detailedBrandAesthetic.join('\n') : (p.detailedBrandAesthetic || ''),
           physicalBranches: Array.isArray(p.physicalBranches) ? p.physicalBranches : (p.physicalBranches ? [{ name: p.physicalBranches, address: '', phone: '', email: '', openingHours: '' }] : [{ name: '', address: '', phone: '', email: '', openingHours: '' }]),
          loyaltyProgram: p.loyaltyProgram || '',
          operationsSummary: formData.operationsSummary, // not AI-managed
          logoUrl: p.logoUrl || formData.logoUrl || '',
          brandColours: typeof p.brandColours === 'object' && p.brandColours !== null
            ? JSON.stringify({ ...EMPTY_PALETTE, ...p.brandColours })
            : (p.brandColours || ''),
        });
        setRefineComments('');
        setSuccess('Profile refined by AI. Review the updated fields below before saving.');
      } else {
        setError(data.error || 'Failed to refine profile via AI.');
      }
    } catch {
      setError('An unexpected error occurred during AI refinement.');
    } finally {
      setAiRefining(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/user/brand-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId: business?.databaseId,
          ...formData,
          // Send uploaded logo bytes so the API can persist it to Google Drive
          logoBase64: logoBase64 ?? undefined,
          logoMimeType: logoBase64 ? logoMimeType : undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess(data.message || 'Brand profile saved successfully!');
        if (data.logoWarning) setError(data.logoWarning);
        // Update logoUrl in form state if API returned a Drive URL
        if (data.logoUrl && data.logoUrl !== formData.logoUrl) {
          setFormData(f => ({ ...f, logoUrl: data.logoUrl }));
          setLogoPreview(data.logoUrl);
          setLogoBase64(null); // clear so we don't re-upload on next save
        }
      } else {
        setError(data.error || 'Got an error from server.');
      }
    } catch (err: any) {
      setError('An unexpected error occurred saving the profile.');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return <div className="text-center py-10 text-gray-500">Loading existing profile...</div>;
  }

  return (
    <div className="w-full mx-auto bg-white p-8 rounded-lg shadow-sm border border-gray-100 mb-10">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">AI Brand Profile Builder</h2>
        <button
          type="button"
          onClick={handleGenerateAI}
          disabled={aiGenerating}
          className={`px-4 py-2 rounded font-bold text-white shadow-sm flex items-center gap-2 ${
            aiGenerating ? 'bg-indigo-300 cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700'
          }`}
        >
          <span>✨</span> {aiGenerating ? 'AI is analyzing your brand…' : 'Auto-Generate with AI'}
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-8">
        The AI scans your website, analyses your Cin7 sales data for real hero products and AOV, and optionally extracts brand colours from your logo. Upload your logo below to enable colour extraction, or let the AI infer colours from your website.
      </p>

      {error && <p className="mb-4 text-sm text-red-600 font-semibold bg-red-50 p-3 rounded">{error}</p>}
      {success && <p className="mb-4 text-sm text-green-700 font-semibold bg-green-50 p-3 rounded">{success}</p>}

      {/* ── Logo + Brand Colours ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 p-5 bg-gray-50 rounded-xl border border-gray-200">

        {/* Logo panel */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Brand Logo</p>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div className="w-20 h-20 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
              {logoPreview
                ? <img src={logoPreview} alt="Logo preview" className="max-w-full max-h-full object-contain p-1" />
                : <span className="text-3xl text-gray-300">🖼️</span>
              }
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <input
                type="text"
                name="logoUrl"
                value={formData.logoUrl}
                onChange={e => {
                  handleChange(e);
                  // Live-update preview when user types a URL
                  if (e.target.value) setLogoPreview(e.target.value);
                }}
                placeholder="Logo URL (auto-filled by AI)"
                className="w-full text-sm p-2 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 truncate"
              />
              <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-1.5 bg-white border border-gray-300 rounded text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                <span>📎 Upload logo</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFile}
                />
              </label>
              {logoBase64 && (
                <p className="text-xs text-green-600">✅ Logo uploaded — AI will extract colours from this image</p>
              )}
            </div>
          </div>
        </div>

        {/* Brand colours panel */}
        <div className="md:col-span-1">
          <p className="text-sm font-semibold text-gray-700 mb-3">Brand Colours</p>
          <div className="space-y-3">
            {COLOUR_ROLES.map(({ key, label, desc }) => {
              const hex = palette[key] || '';
              const isValid = /^#[0-9A-Fa-f]{6}$/.test(hex);
              return (
                <div key={key} className="flex items-center gap-3">
                  {/* Colour picker */}
                  <div className="relative shrink-0">
                    <div
                      className="w-9 h-9 rounded-lg border border-gray-300 shadow-sm overflow-hidden cursor-pointer"
                      style={{ backgroundColor: isValid ? hex : '#e5e7eb' }}
                      title={isValid ? hex : 'No colour set'}
                    >
                      <input
                        type="color"
                        value={isValid ? hex : '#e5e7eb'}
                        onChange={e => updateColour(key, e.target.value.toUpperCase())}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        aria-label={`${label} colour picker`}
                      />
                    </div>
                  </div>
                  {/* Role label + hex input */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-600 leading-tight">{label}</p>
                    <p className="text-xs text-gray-400 leading-tight truncate">{desc}</p>
                  </div>
                  <input
                    type="text"
                    value={hex}
                    onChange={e => updateColour(key, e.target.value.toUpperCase())}
                    placeholder="#000000"
                    maxLength={7}
                    className={`w-24 text-xs p-1.5 border rounded font-mono text-center focus:outline-none focus:ring-1 shrink-0 ${
                      hex && !isValid
                        ? 'border-red-300 focus:ring-red-300'
                        : 'border-gray-300 focus:ring-indigo-300'
                    }`}
                    aria-label={`${label} hex code`}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">Click a swatch to open the colour picker, or type a HEX code directly.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section label="Brand Mission" name="mission" value={formData.mission} onChange={handleChange} placeholder="e.g. Empowering athletes with affordable high-performance gear." onRegenerate={() => handleRegenerateField('mission')} isRegenerating={regeneratingField === 'mission'} />
          <Section label="Unique Value Proposition" name="uvp" value={formData.uvp} onChange={handleChange} placeholder="e.g. NASA-grade materials at 50% cost of competitors." onRegenerate={() => handleRegenerateField('uvp')} isRegenerating={regeneratingField === 'uvp'} />
          <Section label="Brand Tone & Voice" name="tone" value={formData.tone} onChange={handleChange} placeholder="e.g. Energetic, authoritative, bold." onRegenerate={() => handleRegenerateField('tone')} isRegenerating={regeneratingField === 'tone'} />
          <Section label="Target Demographics" name="demographics" value={formData.demographics} onChange={handleChange} placeholder="e.g. Men & Women aged 18-35, fitness enthusiasts." onRegenerate={() => handleRegenerateField('demographics')} isRegenerating={regeneratingField === 'demographics'} />
          <Section label="Top Geographies" name="geo" value={formData.geo} onChange={handleChange} placeholder="e.g. US (60%), UK (15%)." onRegenerate={() => handleRegenerateField('geo')} isRegenerating={regeneratingField === 'geo'} />
          <Section label="Hero Products" name="products" value={formData.products} onChange={handleChange} placeholder="Populated from Cin7 sales data by AI (top 5% of products by revenue)." multiline onRegenerate={() => handleRegenerateField('products')} isRegenerating={regeneratingField === 'products'} />
          <Section label="Price Positioning & AOV" name="pricing" value={formData.pricing} onChange={handleChange} placeholder="Calculated from Cin7 sales by AI — e.g. Mid-market. AOV $85." onRegenerate={() => handleRegenerateField('pricing')} isRegenerating={regeneratingField === 'pricing'} />
          <Section label="Core Customer Praises" name="praises" value={formData.praises} onChange={handleChange} placeholder="Most common positive themes found in reviews." multiline onRegenerate={() => handleRegenerateField('praises')} isRegenerating={regeneratingField === 'praises'} />
          <Section label="Core Objections" name="objections" value={formData.objections} onChange={handleChange} placeholder="Frequent reasons for hesitation or negative reviews." multiline onRegenerate={() => handleRegenerateField('objections')} isRegenerating={regeneratingField === 'objections'} />
          <Section label="Primary Competitors" name="competitors" value={formData.competitors} onChange={handleChange} placeholder="List 3-5 competitors." multiline onRegenerate={() => handleRegenerateField('competitors')} isRegenerating={regeneratingField === 'competitors'} />
          <div className="md:col-span-2">
            <Section label="Market Gap" name="marketGap" value={formData.marketGap} onChange={handleChange} placeholder="Where your brand excels compared to competitors." multiline onRegenerate={() => handleRegenerateField('marketGap')} isRegenerating={regeneratingField === 'marketGap'} />
          </div>
          <Section label="Shipping Policy" name="shippingPolicy" value={formData.shippingPolicy} onChange={handleChange} placeholder="e.g. Free shipping on orders over $75 within Australia (3-5 business days). Express available at checkout. International orders ship in 7-14 days." multiline onRegenerate={() => handleRegenerateField('shippingPolicy')} isRegenerating={regeneratingField === 'shippingPolicy'} />
          <Section label="Returns Policy" name="returnsPolicy" value={formData.returnsPolicy} onChange={handleChange} placeholder="e.g. 30-day returns accepted on unused items in original packaging. Sale items are final sale. Refunds processed within 5 business days of receiving the return." multiline onRegenerate={() => handleRegenerateField('returnsPolicy')} isRegenerating={regeneratingField === 'returnsPolicy'} />
          <div className="md:col-span-2">
            <Section label="Connected Software" name="connectedSoftware" value={formData.connectedSoftware} onChange={handleChange} placeholder="e.g. Cin7 Omni, Shopify, Google Ads, Google Analytics (GA4), Meta Ads" onRegenerate={() => handleRegenerateField('connectedSoftware')} isRegenerating={regeneratingField === 'connectedSoftware'} />
          </div>
        </div>

        {/* ── Brand History ────────────────────────────────────────────────── */}
        <div className="mt-8">
          <Section label="Brand History" name="brandHistory" value={formData.brandHistory} onChange={handleChange} placeholder="AI will research your website and social media to summarise your brand's story — founding year, origin, milestones, and key moments that shaped the brand." multiline onRegenerate={() => handleRegenerateField('brandHistory')} isRegenerating={regeneratingField === 'brandHistory'} />
        </div>

        {/* ── Detailed Brand Aesthetic ─────────────────────────────────────── */}
        <div className="mt-8">
          <Section label="Detailed Brand Aesthetic" name="detailedBrandAesthetic" value={formData.detailedBrandAesthetic} onChange={handleChange} placeholder="Describe your brand's full visual identity — colour palette usage, typography style, photography aesthetic and mood (e.g. clean studio, editorial lifestyle, moody outdoor), lighting preferences, recurring visual motifs, and how products are typically presented. Write as a creative brief for a photographer or designer." multiline onRegenerate={() => handleRegenerateField('detailedBrandAesthetic')} isRegenerating={regeneratingField === 'detailedBrandAesthetic'} />
        </div>

        {/* ── Physical Branches ────────────────────────────────────────────── */}
        <div className="mt-8">
           <div className="flex items-center justify-between gap-2 mb-3">
             <label className="text-sm font-semibold text-gray-700">Physical Branches</label>
             <button
               type="button"
               onClick={() => handleRegenerateField('physicalBranches')}
               disabled={regeneratingField === 'physicalBranches'}
               title="Regenerate branches with AI"
               className={`shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                 regeneratingField === 'physicalBranches'
                   ? 'border-indigo-200 text-indigo-300 cursor-not-allowed bg-indigo-50'
                   : 'border-indigo-200 text-indigo-500 hover:bg-indigo-50 hover:border-indigo-400'
               }`}
             >
               <span>{regeneratingField === 'physicalBranches' ? '⏳' : '✨'}</span>
               <span>{regeneratingField === 'physicalBranches' ? 'Regenerating…' : 'AI'}</span>
             </button>
           </div>
           <div className="space-y-4">
             {Array.isArray(formData.physicalBranches) && formData.physicalBranches.map((branch, idx) => (
               <div key={idx} className="p-4 border border-gray-300 rounded-lg bg-gray-50">
                 <div className="flex items-center justify-between mb-3">
                   <h4 className="font-semibold text-gray-700 text-sm">Branch {idx + 1}</h4>
                   {formData.physicalBranches.length > 1 && (
                     <button
                       type="button"
                       onClick={() => setFormData(f => ({ ...f, physicalBranches: f.physicalBranches.filter((_, i) => i !== idx) }))}
                       className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                     >
                       Remove
                     </button>
                   )}
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                   <input
                     type="text"
                     placeholder="Branch Name"
                     value={branch.name}
                     onChange={(e) => {
                       const updated = [...formData.physicalBranches];
                       updated[idx].name = e.target.value;
                       setFormData(f => ({ ...f, physicalBranches: updated }));
                     }}
                     className="w-full text-sm p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                   />
                   <input
                     type="text"
                     placeholder="Phone"
                     value={branch.phone}
                     onChange={(e) => {
                       const updated = [...formData.physicalBranches];
                       updated[idx].phone = e.target.value;
                       setFormData(f => ({ ...f, physicalBranches: updated }));
                     }}
                     className="w-full text-sm p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                   />
                   <input
                     type="email"
                     placeholder="Email"
                     value={branch.email}
                     onChange={(e) => {
                       const updated = [...formData.physicalBranches];
                       updated[idx].email = e.target.value;
                       setFormData(f => ({ ...f, physicalBranches: updated }));
                     }}
                     className="w-full text-sm p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                   />
                   <input
                     type="text"
                     placeholder="Address"
                     value={branch.address}
                     onChange={(e) => {
                       const updated = [...formData.physicalBranches];
                       updated[idx].address = e.target.value;
                       setFormData(f => ({ ...f, physicalBranches: updated }));
                     }}
                     className="w-full text-sm p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                   />
                   <textarea
                     placeholder="Opening Hours"
                     value={branch.openingHours}
                     onChange={(e) => {
                       const updated = [...formData.physicalBranches];
                       updated[idx].openingHours = e.target.value;
                       setFormData(f => ({ ...f, physicalBranches: updated }));
                     }}
                     rows={2}
                     className="w-full col-span-2 text-sm p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                   />
                 </div>
               </div>
             ))}
           </div>
           <button
             type="button"
             onClick={() => setFormData(f => ({ ...f, physicalBranches: [...f.physicalBranches, { name: '', address: '', phone: '', email: '', openingHours: '' }] }))}
             className="mt-3 px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 font-semibold text-gray-700"
           >
             + Add Another Branch
           </button>
        </div>

        {/* ── Loyalty Program ──────────────────────────────────────────────── */}
        <div className="mt-8">
          <Section
            label="Loyalty Program"
            name="loyaltyProgram"
            value={formData.loyaltyProgram}
            onChange={handleChange}
            placeholder="AI will scan homepage navigation and footer links for loyalty/rewards pages, then summarize key points like points, tiers, perks, and redemption rules."
            multiline
            onRegenerate={() => handleRegenerateField('loyaltyProgram')}
            isRegenerating={regeneratingField === 'loyaltyProgram'}
          />
        </div>

        {/* ── Business Operations Summary ─────────────────────────────────── */}
        <div className="mt-8 p-6 bg-amber-50 rounded-xl border border-amber-200">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-xl mt-0.5">📋</span>
            <div>
              <h3 className="text-sm font-semibold text-amber-800">Business Operations Summary</h3>
              <p className="text-xs text-amber-700 mt-0.5">
                Fill this in yourself — the AI won't touch it. Include any operational details that help make sense of your data, such as when orders are packed and dispatched, how often each branch receives restocks, lead times from suppliers, seasonal patterns, warehouse cut-off times, or anything else useful for interpreting inventory and sales trends.
              </p>
            </div>
          </div>
          <textarea
            name="operationsSummary"
            value={formData.operationsSummary}
            onChange={handleChange}
            rows={6}
            placeholder={`e.g.\n- Orders placed before 2pm are packed and dispatched same day (Mon–Fri).\n- Melbourne warehouse receives supplier restocks every Tuesday.\n- Sydney branch is replenished from Melbourne every fortnight.\n- Lead time from main supplier is 6–8 weeks.\n- Q4 (Oct–Dec) is peak season — stock levels run 40% higher than average.`}
            className="w-full text-sm p-3 border border-amber-300 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 bg-white resize-none mt-1"
          />
        </div>

        <div className="pt-6 border-t border-gray-100 flex justify-end">

        {/* ── AI Refinement panel ─────────────────────────────────────────── */}
        <div className="mb-6 p-5 bg-indigo-50 rounded-xl border border-indigo-200 w-full">
          <p className="text-sm font-semibold text-indigo-800 mb-1 flex items-center gap-2">
            <span>✨</span> Refine with AI
          </p>
          <p className="text-xs text-indigo-600 mb-3">
            Describe what you'd like to change — correct facts, add context, adjust tone, specify products, update colours, etc. The AI will update the fields above while keeping what's already accurate.
          </p>
          <textarea
            value={refineComments}
            onChange={e => setRefineComments(e.target.value)}
            rows={4}
            placeholder={`e.g. "We mainly sell to women aged 25-45 in Australia. Our hero product is actually the XL Tote Bag not the backpack. Primary colour should be forest green #2D5016. We don't compete with Nike — replace with Bellroy and Fjällräven."`}
            className="w-full text-sm p-3 border border-indigo-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white resize-none"
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={handleRefine}
              disabled={aiRefining || !refineComments.trim()}
              className={`px-5 py-2 rounded font-bold text-white shadow-sm flex items-center gap-2 text-sm transition-all ${
                aiRefining || !refineComments.trim()
                  ? 'bg-indigo-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <span>✨</span> {aiRefining ? 'Refining…' : 'Refine Profile with AI'}
            </button>
          </div>
        </div>

          <button
            type="submit"
            disabled={loading}
            className={`py-3 px-8 rounded font-bold text-white shadow-sm transition-all ${
              loading ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? 'Saving to Database...' : 'Save Profile to Database'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface SectionProps {
  label: string;
  name: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (e: any) => void;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

function Section({ label, name, value, placeholder, multiline, onChange, onRegenerate, isRegenerating }: SectionProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-semibold text-gray-700">{label}</label>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isRegenerating}
            title={`Regenerate ${label} with AI`}
            className={`shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
              isRegenerating
                ? 'border-indigo-200 text-indigo-300 cursor-not-allowed bg-indigo-50'
                : 'border-indigo-200 text-indigo-500 hover:bg-indigo-50 hover:border-indigo-400'
            }`}
          >
            <span>{isRegenerating ? '⏳' : '✨'}</span>
            <span>{isRegenerating ? 'Regenerating…' : 'AI'}</span>
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          rows={4}
          placeholder={placeholder}
          className="w-full p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
        />
      ) : (
        <input
          type="text"
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full p-2 border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
        />
      )}
    </div>
  );
}

// --- Connection Status Icon ---
function ConnectionStatus({ result }: { result: any }) {
  if (!result) {
    return (
      <span title="Not tested" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200">
        <span className="w-2 h-2 rounded-full bg-gray-400 block" />
      </span>
    );
  }
  if (result.success) {
    return (
      <span title="Connected" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
        <svg className="w-3.5 h-3.5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
        </svg>
      </span>
    );
  }
  return (
    <span title="Connection failed" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100">
      <svg className="w-3.5 h-3.5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

// --- Connection Help Modal ---
interface HelpStep { text: string; }
interface HelpInfo { title: string; url: string; urlLabel: string; steps: HelpStep[]; }

const HELP: Record<string, HelpInfo> = {
  shopify: {
    title: 'Connect Shopify',
    url: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
    urlLabel: 'Shopify custom apps docs →',
    steps: [
      { text: 'Log in to your Shopify Admin (admin.shopify.com).' },
      { text: 'Go to Settings → Apps and sales channels → Develop apps.' },
      { text: 'Click "Allow custom app development", then "Create an app".' },
      { text: 'Give it a name (e.g. "Marketoir"), then click "Configure Admin API scopes".' },
      { text: 'Enable read_products, read_orders, read_inventory at minimum, then click Save.' },
      { text: 'Go to the API credentials tab and click "Install app".' },
      { text: 'Copy the Admin API access token (starts with shpat_) — this is your Access Token.' },
      { text: 'Your Shop ID is your store URL, e.g. mystore.myshopify.com.' },
    ],
  },
  ga4: {
    title: 'Connect Google Analytics (GA4)',
    url: 'https://analytics.google.com/',
    urlLabel: 'Open Google Analytics →',
    steps: [
      { text: 'Go to analytics.google.com and open your property.' },
      { text: 'Click the gear icon (Admin) in the bottom-left.' },
      { text: 'Under "Property", click Property Settings.' },
      { text: 'Your Property ID is the number shown at the top (e.g. 319628615).' },
      { text: 'Make sure the Google service account used by Marketoir has been granted Viewer access: go to Admin → Property Access Management → Add users, and enter the service account email.' },
    ],
  },
  gads: {
    title: 'Connect Google Ads',
    url: 'https://ads.google.com/',
    urlLabel: 'Open Google Ads →',
    steps: [
      { text: 'Log in to ads.google.com.' },
      { text: 'Your Customer ID is the 10-digit number shown in the top-right corner (format: XXX-XXX-XXXX). Enter it without hyphens.' },
      { text: 'To grant API access, go to Tools & Settings → Access and security → API Center.' },
      { text: 'Ensure a developer token is approved and a refresh token has been generated for the Marketoir service account.' },
    ],
  },
  meta: {
    title: 'Connect Meta Ads',
    url: 'https://business.facebook.com/settings/system-users',
    urlLabel: 'Open Meta Business Settings →',
    steps: [
      { text: 'Go to business.facebook.com → Settings → Users → System Users.' },
      { text: 'Create a System User (or use an existing one) with Admin role.' },
      { text: 'Click "Generate New Token", select your app, and enable ads_read and ads_management permissions.' },
      { text: 'Copy the generated token — this is your Access Token.' },
      { text: 'Your Ad Account ID is found in Meta Ads Manager → top-left dropdown. It is a number like 1234567890 (enter without "act_" prefix, or with — either works).' },
    ],
  },
  cin7: {
    title: 'Connect Cin7 Omni',
    url: 'https://go.cin7.com/',
    urlLabel: 'Open Cin7 Omni →',
    steps: [
      { text: 'Log in to Cin7 Omni at go.cin7.com.' },
      { text: 'Go to Settings → Integrations → API.' },
      { text: 'Note your Account ID shown at the top of the page (e.g. MystoreTGAU).' },
      { text: 'Click "Generate API Key" (or copy an existing one).' },
      { text: 'Copy both the Account ID and the API Key into the fields here, then click Save.' },
    ],
  },
};

function HelpModal({ id, onClose }: { id: string; onClose: () => void }) {
  const info = HELP[id];
  if (!info) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-800">{info.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none mt-0.5">✕</button>
        </div>
        <ol className="flex flex-col gap-2">
          {info.steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
        <a
          href={info.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline font-medium"
        >
          {info.urlLabel}
        </a>
      </div>
    </div>
  );
}

// --- Embedded Connections Component ---
export interface Business { name: string; userId: string; databaseId: string; }

export function ConnectionsTab({ business }: { business: Business | null }) {
  // Per-business credential state
  const [shopId, setShopId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [gaPropertyId, setGaPropertyId] = useState('');
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState('');
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [cin7AccountId, setCin7AccountId] = useState('');
  const [cin7ApiKey, setCin7ApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-pro-preview');
  const [gmailAddress, setGmailAddress] = useState('');
  const [gmailRefreshToken, setGmailRefreshToken] = useState('');
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientSecret, setGmailClientSecret] = useState('');
  const [klaviyoApiKey, setKlaviyoApiKey] = useState('');

  // Xero OAuth state
  const [xeroStatus, setXeroStatus] = useState<{
    connected: boolean;
    tenantName: string | null;
    tenantId: string | null;
    tokenExpiry: number | null;
    envConfigured: boolean;
  } | null>(null);
  const [xeroLoading, setXeroLoading] = useState(false);
  const [xeroDisconnecting, setXeroDisconnecting] = useState(false);

  // Help modal
  const [openHelp, setOpenHelp] = useState<string | null>(null);

  // Gmail OAuth — handle callback params from /api/auth/gmail/callback redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const success = params.get('gmailSuccess');
    const err     = params.get('gmailError');
    if (!success && !err) return;
    // Clean the URL so the params don't persist on reload.
    window.history.replaceState({}, '', window.location.pathname);
    if (err) {
      setGmailResult({ success: false, error: decodeURIComponent(err) });
      return;
    }
    const email = decodeURIComponent(params.get('gmailEmail') ?? '');
    const token = decodeURIComponent(params.get('gmailToken') ?? '');
    if (email) setGmailAddress(email);
    if (token) setGmailRefreshToken(token);
    setGmailResult({ success: true, email, fromOAuth: true });
    // Auto-save — a short delay lets React re-render the updated state first.
    if (email && token) {
      setTimeout(() => saveCard('gmail'), 200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Available Gemini models — loaded once on mount
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);

  // Sync result states
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [gaLoading, setGaLoading] = useState(false);
  const [gaResult, setGaResult] = useState<any>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsResult, setAdsResult] = useState<any>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaResult, setMetaResult] = useState<any>(null);
  const [cin7Loading, setCin7Loading] = useState(false);
  const [cin7Result, setCin7Result] = useState<any>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailResult, setGmailResult] = useState<any>(null);
  const [klaviyoLoading, setKlaviyoLoading] = useState(false);
  const [klaviyoResult, setKlaviyoResult] = useState<any>(null);
  const [savingCard, setSavingCard] = useState<string | null>(null);
  const [cardMsgs, setCardMsgs] = useState<Record<string, string>>({});

  // AI build state (instructions + schema per api)
  const [apiActLoading, setApiActLoading] = useState<Record<string, string>>({});
  const [apiActMsgs, setApiActMsgs] = useState<Record<string, string>>();

  // Load saved credentials + ping whenever the selected business changes
  useEffect(() => {
    if (!business?.databaseId) return;

    // Reset all results when switching business
    setSyncResult(null); setGaResult(null); setAdsResult(null);
      setMetaResult(null); setCin7Result(null); setGmailResult(null); setKlaviyoResult(null);
      setXeroStatus(null);

    const databaseId = business.databaseId;

    async function loadAndPing() {
      // 1. Load saved credentials for this business
      let creds: Record<string, string> = {};
      try {
        const res = await fetch(`/api/user/business-connections?databaseId=${encodeURIComponent(databaseId)}`);
        const data = await res.json();
        if (data.success) creds = data.connections;
      } catch {}

      const sid  = creds.ShopifyShopId       || '';
      const sat  = creds.ShopifyAccessToken  || '';
      const gaId = creds.GA4PropertyId       || '';
      const gads = creds.GoogleAdsCustomerId  || '';
      const maa  = creds.MetaAdAccountId     || '';
      const mat  = creds.MetaAccessToken     || '';
      const c7id = creds.Cin7AccountId       || '';
      const c7k  = creds.Cin7ApiKey          || '';
      const mdl  = creds.GeminiModel         || 'gemini-2.5-pro-preview';
      const gmAddr = creds.GmailAddress      || '';
      const gmTok  = creds.GmailRefreshToken || '';
      const gmCid  = creds.GmailClientId     || '';
      const gmCSec = creds.GmailClientSecret || '';
      const klKey  = creds.KlaviyoApiKey     || '';

      setShopId(sid);
      setAccessToken(sat);
      setSpreadsheetId(databaseId); // database IS the target spreadsheet
      setGaPropertyId(gaId);
      setGoogleAdsCustomerId(gads);
      setMetaAdAccountId(maa);
      setMetaAccessToken(mat);
      setCin7AccountId(c7id);
      setCin7ApiKey(c7k);
      setGeminiModel(mdl);
      setGmailAddress(gmAddr);
      setGmailRefreshToken(gmTok);
      setGmailClientId(gmCid);
      setGmailClientSecret(gmCSec);
      setKlaviyoApiKey(klKey);

      // 2. Auto-ping all connections with the loaded credentials
      const ping = async (url: string, setter: (v: any) => void) => {
        try {
          const r = await fetch(url);
          setter(await r.json());
        } catch {
          setter({ success: false, error: 'Network error' });
        }
      };

      ping(`/api/sync/analytics?propertyId=${encodeURIComponent(gaId)}`, setGaResult);
      ping(`/api/sync/google-ads?customerId=${encodeURIComponent(gads)}`, setAdsResult);
      ping(`/api/sync/meta-ads?adAccountId=${encodeURIComponent(maa)}&accessToken=${encodeURIComponent(mat)}`, setMetaResult);
      ping(`/api/sync/cin7?accountId=${encodeURIComponent(c7id)}&apiKey=${encodeURIComponent(c7k)}`, setCin7Result);
      if (gmTok) {
        ping(`/api/sync/gmail?refreshToken=${encodeURIComponent(gmTok)}`, setGmailResult);
      }
      if (klKey) {
        ping(`/api/sync/klaviyo?apiKey=${encodeURIComponent(klKey)}`, setKlaviyoResult);
      }
      if (sid && sat) {
        ping(`/api/sync/catalog?shopId=${encodeURIComponent(sid)}&accessToken=${encodeURIComponent(sat)}`, setSyncResult);
      }

      // Xero status check
      setXeroLoading(true);
      try {
        const xeroRes = await fetch(`/api/xero/status?databaseId=${encodeURIComponent(databaseId)}`);
        const xeroData = await xeroRes.json();
        setXeroStatus(xeroData);
      } catch {
        setXeroStatus({ connected: false, tenantName: null, tenantId: null, tokenExpiry: null, envConfigured: false });
      } finally {
        setXeroLoading(false);
      }
    }

    loadAndPing();
  }, [business?.databaseId]);

  useEffect(() => {
    fetch('/api/ai/gemini-models')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.models)) setAvailableModels(d.models); })
      .catch(() => {});
  }, []);

  const saveCard = async (cardId: string) => {
    if (!business?.databaseId) return;
    setSavingCard(cardId);
    setCardMsgs(prev => ({ ...prev, [cardId]: '' }));
    try {
      const res = await fetch('/api/user/business-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId: business.databaseId,
          connections: {
            ShopifyShopId: shopId,
            ShopifyAccessToken: accessToken,
            GA4PropertyId: gaPropertyId,
            GoogleAdsCustomerId: googleAdsCustomerId,
            MetaAdAccountId: metaAdAccountId,
            MetaAccessToken: metaAccessToken,
            Cin7AccountId: cin7AccountId,
            Cin7ApiKey: cin7ApiKey,
            GeminiModel: geminiModel,
            GmailAddress: gmailAddress,
            GmailRefreshToken: gmailRefreshToken,
            GmailClientId: gmailClientId,
            GmailClientSecret: gmailClientSecret,
            KlaviyoApiKey: klaviyoApiKey,
          },
        }),
      });
      const data = await res.json();
      setCardMsgs(prev => ({ ...prev, [cardId]: data.success ? '✅ Saved' : `❌ ${data.error}` }));
    } catch {
      setCardMsgs(prev => ({ ...prev, [cardId]: '❌ Save failed' }));
    }
    setSavingCard(null);
  };

  const disconnectXero = async () => {
    if (!business?.databaseId) return;
    if (!confirm('Disconnect Xero? This will remove all saved Xero credentials.')) return;
    setXeroDisconnecting(true);
    try {
      const res = await fetch('/api/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId: business.databaseId }),
      });
      const data = await res.json();
      if (data.success) {
        setXeroStatus({ connected: false, tenantName: null, tenantId: null, tokenExpiry: null, envConfigured: xeroStatus?.envConfigured ?? false });
      }
    } catch {}
    setXeroDisconnecting(false);
  };

  const testShopifySync = async () => {
    setSyncLoading(true); setSyncResult(null);
    try {
      const res = await fetch(`/api/sync/catalog?shopId=${encodeURIComponent(shopId)}&accessToken=${encodeURIComponent(accessToken)}`);
      setSyncResult(await res.json());
    } catch (err: any) { setSyncResult({ success: false, error: err.message }); }
    setSyncLoading(false);
  };

  const testGaSync = async () => {
    setGaLoading(true); setGaResult(null);
    try {
      const res = await fetch(`/api/sync/analytics?propertyId=${encodeURIComponent(gaPropertyId)}`);
      setGaResult(await res.json());
    } catch (err: any) { setGaResult({ success: false, error: err.message }); }
    setGaLoading(false);
  };

  const testGoogleAdsSync = async () => {
    setAdsLoading(true); setAdsResult(null);
    try {
      const res = await fetch(`/api/sync/google-ads?customerId=${encodeURIComponent(googleAdsCustomerId)}`);
      setAdsResult(await res.json());
    } catch (err: any) { setAdsResult({ success: false, error: err.message }); }
    setAdsLoading(false);
  };

  const testMetaSync = async () => {
    setMetaLoading(true); setMetaResult(null);
    try {
      const res = await fetch(`/api/sync/meta-ads?adAccountId=${encodeURIComponent(metaAdAccountId)}&accessToken=${encodeURIComponent(metaAccessToken)}`);
      setMetaResult(await res.json());
    } catch (err: any) { setMetaResult({ success: false, error: err.message }); }
    setMetaLoading(false);
  };

  const testCin7Sync = async () => {
    setCin7Loading(true); setCin7Result(null);
    try {
      const res = await fetch(`/api/sync/cin7?accountId=${encodeURIComponent(cin7AccountId)}&apiKey=${encodeURIComponent(cin7ApiKey)}`);
      setCin7Result(await res.json());
    } catch (err: any) { setCin7Result({ success: false, error: err.message }); }
    setCin7Loading(false);
  };

  const testGmailSync = async () => {
    setGmailLoading(true); setGmailResult(null);
    try {
      const res = await fetch(`/api/sync/gmail?refreshToken=${encodeURIComponent(gmailRefreshToken)}`);
      setGmailResult(await res.json());
    } catch (err: any) { setGmailResult({ success: false, error: err.message }); }
    setGmailLoading(false);
  };

  const testKlaviyoSync = async () => {
    setKlaviyoLoading(true); setKlaviyoResult(null);
    try {
      const res = await fetch(`/api/sync/klaviyo?apiKey=${encodeURIComponent(klaviyoApiKey)}`);
      setKlaviyoResult(await res.json());
    } catch (err: any) { setKlaviyoResult({ success: false, error: err.message }); }
    setKlaviyoLoading(false);
  };

  const buildInstructions = async (api: string) => {
    if (!business?.databaseId) return;
    setApiActLoading(p => ({ ...p, [api]: 'instructions' }));
    setApiActMsgs(p => ({ ...p, [api]: '' }));
    try {
      const res = await fetch('/api/ai/build-api-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api, databaseId: business.databaseId }),
      });
      const data = await res.json();
      setApiActMsgs(p => ({ ...p, [api]: data.success ? `✅ Saved (${data.chars?.toLocaleString()} chars · ${data.endpoints ?? 0} endpoints extracted)` : `❌ ${data.error}` }));
    } catch { setApiActMsgs(p => ({ ...p, [api]: '❌ Failed' })); }
    setApiActLoading(p => ({ ...p, [api]: '' }));
  };

  const buildSchema = async (api: string) => {
    if (!business?.databaseId) return;
    setApiActLoading(p => ({ ...p, [`${api}_schema`]: 'schema' }));
    setApiActMsgs(p => ({ ...p, [`${api}_schema`]: '' }));
    try {
      const res = await fetch('/api/ai/build-api-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api, databaseId: business.databaseId }),
      });
      const data = await res.json();
      setApiActMsgs(p => ({ ...p, [`${api}_schema`]: data.success ? `✅ Schema saved (${data.fieldCount} fields → ${data.sheet})` : `❌ ${data.error}` }));
    } catch { setApiActMsgs(p => ({ ...p, [`${api}_schema`]: '❌ Failed' })); }
    setApiActLoading(p => ({ ...p, [`${api}_schema`]: '' }));
  };

  if (!business) {
    return <div className="text-center py-16 text-gray-400">No business selected.</div>;
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {openHelp && <HelpModal id={openHelp} onClose={() => setOpenHelp(null)} />}
      <p className="text-sm text-gray-500">Credentials for <span className="font-semibold text-gray-700">{business.name}</span> — loaded from their database sheet.</p>

      {/* Shopify */}
      <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">Shopify</h2>
            <ConnectionStatus result={syncResult} />
          </div>
          <button onClick={() => setOpenHelp('shopify')} className="text-xs text-blue-500 hover:underline">How to connect →</button>
        </div>
        <div className="w-full">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Shop ID</label>
          <input className="w-full p-2 border rounded text-sm" value={shopId} onChange={e => setShopId(e.target.value)} placeholder="mystore.myshopify.com" />
        </div>
        <div className="w-full">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Access Token</label>
          <input className="w-full p-2 border rounded text-sm font-mono" type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="shpat_..." />
        </div>
        <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
          <button onClick={testShopifySync} disabled={syncLoading} className="px-4 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition">
            {syncLoading ? 'Syncing...' : 'Test Connection'}
          </button>
          <div className="flex items-center gap-2">
            {cardMsgs['shopify'] && <span className="text-xs font-medium">{cardMsgs['shopify']}</span>}
            <button onClick={() => saveCard('shopify')} disabled={savingCard === 'shopify'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
              {savingCard === 'shopify' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div className="w-full flex flex-col gap-1 pt-2 border-t border-dashed border-gray-200">
          <div className="flex items-center gap-2">
            <button onClick={() => buildInstructions('shopify')} disabled={!!apiActLoading['shopify']} className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 transition">
              {apiActLoading['shopify'] === 'instructions' ? '⏳ Building...' : '📚 Build API Instructions'}
            </button>
            <button onClick={() => buildSchema('shopify')} disabled={!!apiActLoading['shopify_schema']} className="px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 transition">
              {apiActLoading['shopify_schema'] === 'schema' ? '⏳ Generating...' : '🔍 Generate Schema'}
            </button>
          </div>
          {apiActMsgs?.['shopify'] && <p className="text-xs text-gray-600">{apiActMsgs['shopify']}</p>}
          {apiActMsgs?.['shopify_schema'] && <p className="text-xs text-gray-600">{apiActMsgs['shopify_schema']}</p>}
        </div>
        {syncResult && <pre className="w-full p-4 bg-gray-100 rounded text-xs overflow-auto">{JSON.stringify(syncResult, null, 2)}</pre>}
      </div>

      {/* 3. Others */}
      <div className="grid grid-cols-2 gap-4 w-full">
        {/* GA4 */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Google Analytics</h2>
              <ConnectionStatus result={gaResult} />
            </div>
            <button onClick={() => setOpenHelp('ga4')} className="text-xs text-blue-500 hover:underline">How to connect →</button>
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">GA4 Property ID</label>
            <input className="w-full p-2 border rounded text-sm" value={gaPropertyId} onChange={e => setGaPropertyId(e.target.value)} placeholder="e.g. 319628615" />
          </div>
          <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={testGaSync} disabled={gaLoading} className="px-3 py-1.5 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 transition">
              {gaLoading ? 'Testing...' : 'Test'}
            </button>
            <div className="flex items-center gap-2">
              {cardMsgs['ga4'] && <span className="text-xs font-medium">{cardMsgs['ga4']}</span>}
              <button onClick={() => saveCard('ga4')} disabled={savingCard === 'ga4'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
                {savingCard === 'ga4' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div className="w-full flex flex-col gap-1 pt-2 border-t border-dashed border-gray-200">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => buildInstructions('ga4')} disabled={!!apiActLoading['ga4']} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 transition">
                {apiActLoading['ga4'] === 'instructions' ? '⏳' : '📚'} Build
              </button>
              <button onClick={() => buildSchema('ga4')} disabled={!!apiActLoading['ga4_schema']} className="px-2 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 transition">
                {apiActLoading['ga4_schema'] === 'schema' ? '⏳' : '🔍'} Schema
              </button>
            </div>
            {apiActMsgs?.['ga4'] && <p className="text-xs text-gray-600">{apiActMsgs['ga4']}</p>}
            {apiActMsgs?.['ga4_schema'] && <p className="text-xs text-gray-600">{apiActMsgs['ga4_schema']}</p>}
          </div>
          {gaResult && <pre className="w-full p-4 bg-gray-100 rounded text-xs overflow-auto max-h-32">{JSON.stringify(gaResult, null, 2)}</pre>}
        </div>

        {/* Google Ads */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Google Ads</h2>
              <ConnectionStatus result={adsResult} />
            </div>
            <button onClick={() => setOpenHelp('gads')} className="text-xs text-blue-500 hover:underline">How to connect →</button>
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Customer ID</label>
            <input className="w-full p-2 border rounded text-sm" value={googleAdsCustomerId} onChange={e => setGoogleAdsCustomerId(e.target.value)} placeholder="e.g. 2436440046" />
          </div>
          <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={testGoogleAdsSync} disabled={adsLoading} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-medium hover:bg-blue-600 transition">
              {adsLoading ? 'Testing...' : 'Test'}
            </button>
            <div className="flex items-center gap-2">
              {cardMsgs['gads'] && <span className="text-xs font-medium">{cardMsgs['gads']}</span>}
              <button onClick={() => saveCard('gads')} disabled={savingCard === 'gads'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
                {savingCard === 'gads' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div className="w-full flex flex-col gap-1 pt-2 border-t border-dashed border-gray-200">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => buildInstructions('google-ads')} disabled={!!apiActLoading['google-ads']} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 transition">
                {apiActLoading['google-ads'] === 'instructions' ? '⏳' : '📚'} Build
              </button>
              <button onClick={() => buildSchema('google-ads')} disabled={!!apiActLoading['google-ads_schema']} className="px-2 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 transition">
                {apiActLoading['google-ads_schema'] === 'schema' ? '⏳' : '🔍'} Schema
              </button>
            </div>
            {apiActMsgs?.['google-ads'] && <p className="text-xs text-gray-600">{apiActMsgs['google-ads']}</p>}
            {apiActMsgs?.['google-ads_schema'] && <p className="text-xs text-gray-600">{apiActMsgs['google-ads_schema']}</p>}
          </div>
          {adsResult && <pre className="w-full p-4 bg-gray-100 rounded text-xs overflow-auto max-h-32">{JSON.stringify(adsResult, null, 2)}</pre>}
        </div>

        {/* Meta */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Meta Ads</h2>
              <ConnectionStatus result={metaResult} />
            </div>
            <button onClick={() => setOpenHelp('meta')} className="text-xs text-blue-500 hover:underline">How to connect →</button>
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Ad Account ID</label>
            <input className="w-full p-2 border rounded text-sm" value={metaAdAccountId} onChange={e => setMetaAdAccountId(e.target.value)} placeholder="act_..." />
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Access Token</label>
            <input className="w-full p-2 border rounded text-sm font-mono" type="password" value={metaAccessToken} onChange={e => setMetaAccessToken(e.target.value)} placeholder="EAAi..." />
          </div>
          <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={testMetaSync} disabled={metaLoading} className="px-3 py-1.5 bg-indigo-500 text-white rounded text-xs font-medium hover:bg-indigo-600 transition">
              {metaLoading ? 'Testing...' : 'Test'}
            </button>
            <div className="flex items-center gap-2">
              {cardMsgs['meta'] && <span className="text-xs font-medium">{cardMsgs['meta']}</span>}
              <button onClick={() => saveCard('meta')} disabled={savingCard === 'meta'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
                {savingCard === 'meta' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <div className="w-full flex flex-col gap-1 pt-2 border-t border-dashed border-gray-200">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => buildInstructions('meta')} disabled={!!apiActLoading['meta']} className="px-2 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 transition">
                {apiActLoading['meta'] === 'instructions' ? '⏳' : '📚'} Build
              </button>
              <button onClick={() => buildSchema('meta')} disabled={!!apiActLoading['meta_schema']} className="px-2 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 transition">
                {apiActLoading['meta_schema'] === 'schema' ? '⏳' : '🔍'} Schema
              </button>
            </div>
            {apiActMsgs?.['meta'] && <p className="text-xs text-gray-600">{apiActMsgs['meta']}</p>}
            {apiActMsgs?.['meta_schema'] && <p className="text-xs text-gray-600">{apiActMsgs['meta_schema']}</p>}
          </div>
          {metaResult && <pre className="w-full p-4 bg-gray-100 rounded text-xs overflow-auto max-h-32">{JSON.stringify(metaResult, null, 2)}</pre>}
        </div>

        {/* Cin7 Omni */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Cin7 Omni</h2>
              <ConnectionStatus result={cin7Result} />
            </div>
            <button onClick={() => setOpenHelp('cin7')} className="text-xs text-blue-500 hover:underline">How to connect →</button>
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Account ID</label>
            <input className="w-full p-2 border rounded text-sm" value={cin7AccountId} onChange={e => setCin7AccountId(e.target.value)} placeholder="e.g. MystoreTGAU" />
          </div>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">API Key</label>
            <input className="w-full p-2 border rounded text-sm font-mono" type="password" value={cin7ApiKey} onChange={e => setCin7ApiKey(e.target.value)} placeholder="API key..." />
          </div>
          <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={testCin7Sync} disabled={cin7Loading} className="px-3 py-1.5 bg-teal-500 text-white rounded text-xs font-medium hover:bg-teal-600 transition">
              {cin7Loading ? 'Testing...' : 'Test'}
            </button>
            <div className="flex items-center gap-2">
              {cardMsgs['cin7'] && <span className="text-xs font-medium">{cardMsgs['cin7']}</span>}
              <button onClick={() => saveCard('cin7')} disabled={savingCard === 'cin7'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
                {savingCard === 'cin7' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          {cin7Result && <pre className="w-full p-4 bg-gray-100 rounded text-xs overflow-auto max-h-32">{JSON.stringify(cin7Result, null, 2)}</pre>}
        </div>

        {/* Klaviyo */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Klaviyo</h2>
              <ConnectionStatus result={klaviyoResult} />
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Connect Klaviyo to sync email campaigns, automation flows and subscriber lists into the Marketing Data sheet for AI analysis.
          </p>
          <div className="w-full">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Private API Key</label>
            <input
              className="w-full p-2 border rounded text-sm font-mono"
              type="password"
              value={klaviyoApiKey}
              onChange={e => setKlaviyoApiKey(e.target.value)}
              placeholder="pk_..."
            />
            <p className="text-xs text-gray-400 mt-1">Found in Klaviyo → Settings → API Keys → Create Private API Key.</p>
          </div>
          <div className="w-full flex items-center justify-between pt-2 border-t border-gray-100">
            <button onClick={testKlaviyoSync} disabled={klaviyoLoading || !klaviyoApiKey} className="px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 transition disabled:opacity-40">
              {klaviyoLoading ? 'Testing...' : 'Test Connection'}
            </button>
            <div className="flex items-center gap-2">
              {cardMsgs['klaviyo'] && <span className="text-xs font-medium">{cardMsgs['klaviyo']}</span>}
              <button onClick={() => saveCard('klaviyo')} disabled={savingCard === 'klaviyo'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
                {savingCard === 'klaviyo' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          {klaviyoResult && (
            klaviyoResult.success
              ? <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 w-full">✅ {klaviyoResult.message}</p>
              : <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 w-full">❌ {klaviyoResult.error}</p>
          )}
        </div>

        {/* Gmail */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4 col-span-2">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#EA4335', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><rect width="16" height="12" rx="2" fill="#EA4335"/><path d="M1 1.5 8 7l7-5.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round"/></svg>
              </div>
              <h2 className="text-lg font-bold">Gmail</h2>
              {gmailAddress
                ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold border border-green-200">Connected</span>
                : <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold border border-gray-200">Not connected</span>
              }
            </div>
          </div>

          {/* Step 1 — always visible: Google Cloud credentials */}
          <div className="w-full">
            <p className="text-xs font-semibold text-gray-700 mb-2">Step 1 — Your Google Cloud OAuth credentials</p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
              <p className="text-xs font-semibold text-blue-800 mb-2">One-time Google Cloud setup:</p>
              <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>
                  <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">Enable the Gmail API ↗</a> in your Google Cloud project.
                </li>
                <li>
                  Go to <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">OAuth 2.0 Clients ↗</a>, create a <strong>Web application</strong> client, and add this as an authorised redirect URI:
                  <br />
                  <code className="mt-1 inline-block bg-white border border-blue-200 rounded px-2 py-0.5 text-blue-800 select-all">
                    {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/gmail/callback` : '/api/auth/gmail/callback'}
                  </code>
                </li>
                <li>
                  Go to <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">Auth → Audience ↗</a>. If the app is in <em>Testing</em> mode, scroll to <strong>Test users → + Add users</strong> and add the Gmail address you want to connect.
                </li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from your OAuth client and paste them below.</li>
              </ol>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Client ID</label>
                <input className="w-full p-2 border rounded text-sm font-mono" value={gmailClientId} onChange={e => setGmailClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Client Secret</label>
                <input className="w-full p-2 border rounded text-sm font-mono" type="password" value={gmailClientSecret} onChange={e => setGmailClientSecret(e.target.value)} placeholder="GOCSPX-..." />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button onClick={() => saveCard('gmail')} disabled={savingCard === 'gmail' || !gmailClientId || !gmailClientSecret} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition disabled:opacity-40">
                {savingCard === 'gmail' ? 'Saving…' : 'Save credentials'}
              </button>
              {cardMsgs['gmail'] && <span className="text-xs font-medium">{cardMsgs['gmail']}</span>}
            </div>
          </div>

          {/* Step 2 — connect / status */}
          <div className="w-full border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-700 mb-2">Step 2 — Connect your Gmail account</p>
            {gmailAddress ? (
              <>
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg mb-3">
                  <p className="text-sm font-semibold text-green-800">📧 {gmailAddress}</p>
                  <p className="text-xs text-green-600 mt-1">Gmail is connected. Customer-service email features are active.</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button onClick={testGmailSync} disabled={gmailLoading} className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 transition disabled:opacity-40">
                    {gmailLoading ? 'Checking…' : '✓ Verify connection'}
                  </button>
                  <a href={`/api/auth/gmail/connect?businessId=${encodeURIComponent(business?.databaseId ?? '')}`} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition">
                    🔄 Change Gmail account
                  </a>
                  <button
                    onClick={async () => {
                      if (!confirm('Disconnect Gmail? This removes the stored token.')) return;
                      setGmailAddress(''); setGmailRefreshToken(''); setGmailResult(null);
                      setTimeout(() => saveCard('gmail'), 100);
                    }}
                    className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200 transition border border-red-200"
                  >
                    Disconnect
                  </button>
                </div>
                {gmailResult && (
                  gmailResult.success
                    ? <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 mt-2">✅ Verified — signed in as <strong>{gmailResult.email}</strong>{gmailResult.messagesTotal ? ` · ${gmailResult.messagesTotal.toLocaleString()} messages` : ''}</p>
                    : <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">❌ {gmailResult.error}</p>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  {gmailClientId && gmailClientSecret
                    ? 'Credentials saved. Click the button below to sign in with Google and grant Gmail access.'
                    : 'Save your Client ID and Secret above first.'}
                </p>
                <a
                  href={`/api/auth/gmail/connect?businessId=${encodeURIComponent(business?.databaseId ?? '')}`}
                  className={`px-4 py-2 rounded text-sm font-semibold inline-flex items-center gap-2 transition ${gmailClientId && gmailClientSecret ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-200 text-gray-400 pointer-events-none'}`}
                  aria-disabled={!gmailClientId || !gmailClientSecret}
                >
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M1 1.5 8 7l7-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Connect Gmail account
                </a>
                {gmailResult && !gmailResult.success && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mt-2">❌ {gmailResult.error}</p>
                )}
                {/* Advanced: manual token entry */}
                <details className="mt-3">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">Advanced: paste refresh token manually</summary>
                  <div className="mt-3 flex flex-col gap-3 pl-2 border-l-2 border-gray-100">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Gmail Address</label>
                      <input className="w-full p-2 border rounded text-sm" value={gmailAddress} onChange={e => setGmailAddress(e.target.value)} placeholder="you@gmail.com" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Refresh Token</label>
                      <input className="w-full p-2 border rounded text-sm font-mono" type="password" value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)} placeholder="1//0g..." />
                      <p className="text-xs text-gray-400 mt-1">Or generate with: <code className="bg-gray-100 px-1 rounded">node scripts/get-gmail-token.mjs</code></p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={testGmailSync} disabled={gmailLoading || !gmailRefreshToken} className="px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 transition disabled:opacity-40">
                        {gmailLoading ? 'Testing…' : 'Test token'}
                      </button>
                      <button onClick={() => saveCard('gmail')} disabled={savingCard === 'gmail' || !gmailRefreshToken} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition disabled:opacity-40">
                        {savingCard === 'gmail' ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>

        {/* Xero */}
        <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              {/* Xero logo colour mark */}
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#13B5EA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: 14 }}>X</span>
              </div>
              <h2 className="text-lg font-bold">Xero</h2>
              {xeroLoading && <span className="text-xs text-gray-400">Checking...</span>}
              {!xeroLoading && xeroStatus?.connected && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold border border-green-200">Connected</span>
              )}
              {!xeroLoading && xeroStatus && !xeroStatus.connected && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold border border-gray-200">Not connected</span>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            Connect Xero to sync invoices, bills, and contacts for AI-powered financial analysis and automated purchase order creation.
          </p>

          {xeroStatus?.connected ? (
            <>
              <div className="w-full p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-semibold text-green-800">{xeroStatus.tenantName}</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Token expires: {xeroStatus.tokenExpiry
                    ? new Date(xeroStatus.tokenExpiry).toLocaleString()
                    : 'unknown'}
                </p>
              </div>
              <div className="w-full flex items-center pt-2 border-t border-gray-100">
                <button
                  onClick={disconnectXero}
                  disabled={xeroDisconnecting}
                  className="px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 transition disabled:opacity-40"
                >
                  {xeroDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </>
          ) : xeroStatus?.envConfigured ? (
            <div className="w-full pt-2 border-t border-gray-100">
              <a
                href={business?.databaseId ? `/api/xero/connect?databaseId=${encodeURIComponent(business.databaseId)}` : '#'}
                className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold text-white transition"
                style={{ background: '#13B5EA' }}
              >
                <span>Connect to Xero</span>
                <span>→</span>
              </a>
              <p className="text-xs text-gray-400 mt-2">
                You&apos;ll be redirected to Xero to authorise access, then returned here.
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 w-full">
              ⚠️ <code className="font-mono">XERO_CLIENT_ID</code> and <code className="font-mono">XERO_REDIRECT_URI</code> must be set in <code className="font-mono">.env</code> before connecting.
            </p>
          )}
        </div>
      </div>

      {/* AI Settings */}
      <div className="bg-white text-black p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-start gap-4">
        <h2 className="text-lg font-bold">AI Settings</h2>
        <div className="w-full">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Gemini Model</label>
          {availableModels.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Loading available models...</p>
          ) : (
            <select
              className="w-full p-2 border rounded text-sm"
              value={geminiModel}
              onChange={e => setGeminiModel(e.target.value)}
            >
              {availableModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
              ))}
            </select>
          )}
          <p className="text-xs text-gray-400 mt-1">Used for AI Brand Profile generation.</p>
        </div>
        <div className="w-full flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          {cardMsgs['ai'] && <span className="text-xs font-medium">{cardMsgs['ai']}</span>}
          <button onClick={() => saveCard('ai')} disabled={savingCard === 'ai'} className="px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-semibold hover:bg-gray-900 transition">
            {savingCard === 'ai' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
// --- Data Source Tab ---
export function DataSourceTab({ business }: { business: Business | null }) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState('');
  const [cacheStatus, setCacheStatus] = useState<{ count: number; updatedAt: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/settings/inventory-source')
      .then(r => r.json())
      .then(data => { if (data.success) setSource(data.source); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load IMS cache status once on mount (independent of selected source)
  useEffect(() => {
    fetch('/api/ims/refresh-sales-cache')
      .then(r => r.json())
      .then(data => { if (data.success) setCacheStatus({ count: data.count, updatedAt: data.updatedAt }); })
      .catch(() => {});
  }, []);

  async function selectSource(newSource: string) {
    if (saving) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/settings/inventory-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newSource }),
      });
      const data = await res.json();
      if (data.success) {
        setSource(data.source);
        setMsg('Data source updated successfully.');
      } else {
        setMsg(data.error ?? 'Failed to update data source.');
      }
    } catch {
      setMsg('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshCache() {
    setRefreshing(true);
    setMsg('');
    try {
      const res = await fetch('/api/ims/refresh-sales-cache', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCacheStatus({ count: data.variantsUpdated, updatedAt: data.refreshedAt });
        setMsg(`Cache refreshed — ${data.variantsUpdated} variants updated.`);
      } else {
        setMsg(data.error ?? 'Refresh failed.');
      }
    } catch {
      setMsg('Network error. Please try again.');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading...</div>;

  const tileBase = 'relative rounded-xl border-2 p-5 text-left transition-all w-full';
  const tileActive = 'border-blue-500 bg-blue-50';
  const tileIdle = 'border-gray-200 bg-white hover:border-blue-300';
  const tileDisabled = 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed';

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Inventory Data Source</h2>
      <p className="text-sm text-gray-500 mb-6">
        Choose which system Solvantis reads product, stock, and sales data from.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* Cin7 */}
        <button
          onClick={() => selectSource('cin7')}
          disabled={saving}
          className={`${tileBase} ${source === 'cin7' ? tileActive : tileIdle}`}
        >
          {source === 'cin7' && (
            <span className="absolute top-3 right-3 text-blue-500 font-bold text-lg">✓</span>
          )}
          <div className="text-2xl mb-2">📦</div>
          <div className="font-semibold text-gray-900 mb-1">Cin7</div>
          <div className="text-xs text-gray-500">
            Products, stock, and sales synced from Cin7 Core or Cin7 Omni.
          </div>
        </button>

        {/* Solvantis IMS — div to allow nested Refresh button */}
        <div
          onClick={() => selectSource('solvantis')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && selectSource('solvantis')}
          className={`${tileBase} ${source === 'solvantis' ? tileActive : tileIdle} cursor-pointer`}
        >
          {source === 'solvantis' && (
            <span className="absolute top-3 right-3 text-blue-500 font-bold text-lg">✓</span>
          )}
          <div className="text-2xl mb-2">🏭</div>
          <div className="font-semibold text-gray-900 mb-1">Solvantis IMS</div>
          <div className="text-xs text-gray-500">
            Products, stock, and sales from Solvantis Inventory Management System.
          </div>
          {cacheStatus !== null ? (
            <div className="mt-2 text-xs text-gray-500 border-t border-gray-200 pt-2">
              {cacheStatus.count > 0
                ? `${cacheStatus.count} variants cached`
                : 'Cache empty — click Refresh to populate.'}
              {cacheStatus.updatedAt && (
                <span className="block text-gray-400 mt-0.5">
                  Last: {new Date(cacheStatus.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-2 text-xs text-amber-600 border-t border-gray-200 pt-2">
              Not synced yet.
            </div>
          )}
          <button
            onClick={e => { e.stopPropagation(); refreshCache(); }}
            disabled={refreshing || saving}
            className="mt-3 text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-1 rounded-lg transition-colors"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh Cache'}
          </button>
        </div>

      </div>

      {msg && (
        <p className={`text-sm ${msg.includes('updated') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>
      )}
    </div>
  );
}

// --- POS Settings Tab ---
export function PosSettingsTab() {
  const [methods, setMethods] = useState<string[]>([]);
  const [newMethod, setNewMethod] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/pos/settings/payment-methods').then(r => r.json()).then(d => setMethods(d.methods ?? [])).catch(() => {});
  }, []);

  async function saveMethods() {
    setLoading(true);
    await fetch('/api/pos/settings/payment-methods', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ methods }) });
    setMsg('Payment methods saved.');
    setLoading(false);
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">POS Settings</h2>
        <a href="/pos" target="_blank" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">Open POS →</a>
      </div>

      {msg && <p className="text-sm font-medium text-blue-600">{msg}</p>}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Payment Methods</h3>
        <p className="text-xs text-gray-500">These appear as payment options in the POS payment screen.</p>
        <div className="space-y-2">
          {methods.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={m} onChange={e => setMethods(prev => prev.map((v, j) => j === i ? e.target.value : v))} className="flex-1 p-2 border border-gray-300 rounded text-sm" />
              <button onClick={() => setMethods(prev => prev.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newMethod} onChange={e => setNewMethod(e.target.value)} placeholder="Add method…" className="flex-1 p-2 border border-gray-300 rounded text-sm" onKeyDown={e => { if (e.key === 'Enter' && newMethod.trim()) { setMethods(p => [...p, newMethod.trim()]); setNewMethod(''); }}} />
          <button onClick={() => { if (newMethod.trim()) { setMethods(p => [...p, newMethod.trim()]); setNewMethod(''); }}} className="px-3 py-2 bg-gray-800 text-white rounded text-sm">Add</button>
        </div>
        <button onClick={saveMethods} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition">
          {loading ? 'Saving…' : 'Save Methods'}
        </button>
      </div>
    </div>
  );
}


// --- Team Tab ---
function TeamTab({ business }: { business: { name: string; userId: string; databaseId: string } | null }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) setEmail('');
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    }
    setLoading(false);
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/admin/export');
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Export failed.');
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? 'solvantis-export.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Export failed.');
    }
    setExporting(false);
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-100 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Team Members</h2>
        <p className="text-sm text-gray-500">Invite people to join <strong>{business?.name ?? 'your business'}</strong> on Solvantis. They&apos;ll receive an email with a link to set up their account.</p>
      </div>

      <form onSubmit={sendInvite} className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-bold text-gray-600 uppercase">Email Address</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder="colleague@company.com"
            className="w-full p-2 border border-gray-300 rounded mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-600 uppercase">Role</label>
          <select value={role} onChange={e => setRole(e.target.value as 'user' | 'admin')}
            className="w-full p-2 border border-gray-300 rounded mt-1">
            <option value="user">User — can use the app, cannot invite others</option>
            <option value="admin">Admin — full access, can invite team members</option>
          </select>
        </div>

        {result && (
          <div className={`p-3 rounded text-sm ${result.success ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {result.success ? result.message : result.error}
          </div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? 'Sending invite...' : 'Send Invite Email'}
        </button>
      </form>

      <div className="pt-4 border-t border-gray-100">
        <h3 className="text-sm font-bold text-gray-700 mb-1">Data Export</h3>
        <p className="text-xs text-gray-500 mb-3">Download all your business data as a JSON file. Encrypted credentials are excluded.</p>
        <button
          type="button"
          onClick={exportData}
          disabled={exporting}
          className="px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-lg hover:bg-gray-900 disabled:opacity-50"
        >
          {exporting ? 'Preparing export...' : '⬇ Export My Data'}
        </button>
      </div>
    </div>
  );
}

// --- Main Setup Page Layout ---
function SetupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = searchParams.get('tab') === 'business'
    ? 'business'
    : searchParams.get('tab') === 'profile'
    ? 'profile'
    : searchParams.get('tab') === 'appearance'
    ? 'appearance'
    : searchParams.get('tab') === 'data-source'
    ? 'data-source'
    : 'connections';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Business selector state
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [bizLoading, setBizLoading] = useState(true);

  useEffect(() => {
    async function loadBusinesses() {
      try {
        const res = await fetch('/api/user/businesses');
        const data = await res.json();
        if (data.success && data.businesses.length > 0) {
          setBusinesses(data.businesses);
          setSelectedBusiness(data.businesses[0]);
        }
      } catch {}
      finally { setBizLoading(false); }
    }
    loadBusinesses();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Workspace Setup</h1>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 text-sm font-semibold border rounded-lg shadow-sm bg-white text-gray-700 hover:bg-gray-100 transition-colors"
          >
            &larr; Back to Dashboard
          </button>
        </div>
      </header>

      {/* Business Selector */}
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center gap-3">
          <span className="text-sm font-medium text-gray-500 whitespace-nowrap">Business:</span>
          {bizLoading ? (
            <span className="text-sm text-gray-400">Loading...</span>
          ) : businesses.length === 0 ? (
            <span className="text-sm text-gray-400">No businesses found</span>
          ) : (
            <select
              value={selectedBusiness?.databaseId || ''}
              onChange={e => {
                const biz = businesses.find(b => b.databaseId === e.target.value) || null;
                setSelectedBusiness(biz);
              }}
              className="text-sm font-semibold text-gray-800 border border-gray-200 rounded-md px-3 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {businesses.map(b => (
                <option key={b.databaseId} value={b.databaseId}>{b.name}</option>
              ))}
            </select>
          )}
          {selectedBusiness && (
            <span className="text-xs text-gray-400 hidden sm:inline">DB: {selectedBusiness.databaseId}</span>
          )}
        </div>
      </div>

      {/* Tabs Layout */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="border-b border-gray-200 mb-8">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('connections')}
              className={`${
                activeTab === 'connections'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              Step 1: Connections
            </button>
            <button
              onClick={() => setActiveTab('business')}
              className={`${
                activeTab === 'business'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              Step 2: Business Info
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`${
                activeTab === 'profile'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              Step 3: AI Brand Profile
            </button>
            <button
              onClick={() => setActiveTab('appearance')}
              className={`${
                activeTab === 'appearance'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              Appearance
            </button>
            <button
              onClick={() => setActiveTab('pos')}
              className={`${
                activeTab === 'pos'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              🛒 POS
            </button>
            <button
              onClick={() => setActiveTab('data-source')}
              className={`${
                activeTab === 'data-source'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              🔌 Data Source
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`${
                activeTab === 'team'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors font-nav`}
            >
              👥 Team
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="mt-4">
          {activeTab === 'connections' && <ConnectionsTab business={selectedBusiness} />}
          {activeTab === 'business' && <BusinessInfoTab business={selectedBusiness} />}
          {activeTab === 'profile' && <BrandProfileTab business={selectedBusiness} />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'pos' && <PosSettingsTab />}
          {activeTab === 'data-source' && <DataSourceTab business={selectedBusiness} />}
          {activeTab === 'team' && <TeamTab business={selectedBusiness} />}
        </div>
      </main>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center">Loading Setup...</div>}>
      <SetupPageContent />
    </Suspense>
  )
}
