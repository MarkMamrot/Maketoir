const fs = require('fs');
const ts = require('typescript');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
require('dotenv').config({ quiet: true });

async function componentBundle() {
  const source = fs.readFileSync('src/app/pos/page.tsx', 'utf8');
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
    }
  }
  const selected = new Set();
  const include = name => {
    const declaration = declarations.get(name);
    if (!declaration || selected.has(declaration)) return;
    selected.add(declaration);
    const visit = node => { if (ts.isIdentifier(node)) include(node.text); ts.forEachChild(node, visit); };
    ts.forEachChild(declaration, visit);
  };
  ['PosProductStockModal', 'PosVariantPicker', 'PosAvatarBar'].forEach(include);
  const code = `import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
    import { createRoot } from 'react-dom/client';
    import { compareProductVariants } from './src/lib/pos/productVariantOrder';
    import { useChatNotificationSound, isIncomingChatMessage } from './src/lib/pos/useChatNotificationSound';
    ${[...selected].map(statement => statement.getText(tree)).join('\n')}
    const variants = ['XL', 'XS', 'M', 'S', 'L'].map(size => ({variant_id:size, product_id:'shirt', name:'Fixture Shirt — '+size, code:'SH-'+size, price:20, soh:2, available:2, image_url:'/avatars/1.png'}));
    function Probe() { const [mode,setMode]=useState('stock'); const [chatOpen,setChatOpen]=useState(false);
      return <><button onClick={()=>setMode('stock')}>Stock probe</button><button onClick={()=>setMode('picker')}>Picker probe</button><button onClick={()=>setMode('chat')}>Chat probe</button>
      {mode==='stock' && <PosProductStockModal variants={variants} onClose={()=>setMode('none')}/>}
      {mode==='picker' && <PosVariantPicker variants={variants} onSelect={()=>{}} onInfo={()=>setMode('stock')} onClose={()=>setMode('none')}/>}
      {mode==='chat' && <PosAvatarBar myLocationId={1} myAvatar='' userName='Probe' saleRefreshTick={0} morningGreetingTick={0} cartLeft={false} chatOpen={chatOpen} onChatOpenChange={setChatOpen}/>}</>; }
    createRoot(document.getElementById('probe')).render(<Probe/>);`;
  return (await esbuild.build({ stdin: { contents: code, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: 'http://localhost:3037', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login');
    await page.setContent('<html><head><style>:root{--sv-bg-1:#fff;--sv-bg-2:#eee;--sv-text-strong:#222;--sv-text-main:#333;--sv-text-dim:#666;--sv-etch:#ccc;--sv-action:#178499;--sv-mint:#108366}body{font-family:sans-serif;padding:30px}</style></head><body><div id="probe"></div></body></html>');
    await page.route('**/api/pos/stock?*', route => route.fulfill({ json: { success: true, description: '<p>Full product details retained.</p>', image_url: '/avatars/1.png', data: [{ location_name: 'Fixture store', qty_on_hand: 2, qty_committed: 0 }] } }));
    await page.route('**/avatars/1.png', route => route.fulfill({ contentType: 'image/png', body: fs.readFileSync('public/avatars/l1_base_boy_1.png') }));
    await page.route('**/api/pos/leaderboard', route => route.fulfill({ json: { locations: [{ id: 1, name: 'My store', today_sales: 0, avatar: '' }, { id: 2, name: 'Other store', today_sales: 0, avatar: '' }] } }));
    await page.route('**/api/pos/chat*', route => route.fulfill({ json: { messages: [{ id: 1, location_id: 2, location_name: 'Other store', message: 'Old history', user_name: 'Staff', created_at: new Date().toISOString() }] } }));
    await page.evaluate(() => {
      window.probeSounds = 0;
      const ActualAudio = window.AudioContext;
      window.AudioContext = class extends ActualAudio { createOscillator() { window.probeSounds++; return super.createOscillator(); } };
      window.probeStreams = [];
      window.EventSource = class { constructor() { window.probeStreams.push(this); } close() {} };
    });
    await page.addScriptTag({ content: await componentBundle() });
    await page.getByText('Full product details retained.').waitFor();
    if (!await page.getByRole('img', { name: 'Fixture Shirt' }).evaluate(image => image.complete && image.naturalWidth > 0)) throw new Error('Grouped product image did not render');
    const stockSizes = await page.locator('section > div > strong').allTextContents();
    if (stockSizes.join(',') !== 'XS,S,M,L,XL') throw new Error('Grouped stock sizes out of order: ' + stockSizes);
    await page.screenshot({ path: 'tmp/support-products-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tmp/support-products-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Picker probe', exact: true }).click();
    const pickerLabels = await page.getByRole('dialog').locator('button > span:first-child > span:first-child').allTextContents();
    if (pickerLabels.join(',') !== 'XS,S,M,L,XL') throw new Error('Picker sizes out of order');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Chat probe', exact: true }).click();
    await page.getByRole('button', { name: /Open Team Chat/ }).click();
    const input = page.getByPlaceholder('Message the team…');
    await input.focus();
    await input.evaluate(element => {
      const clipboard = new DataTransfer();
      clipboard.items.add(new File(['fixture'], 'pasted.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    });
    await page.getByText('pasted.png', { exact: true }).waitFor();
    await page.waitForFunction(() => window.probeStreams.length > 0);
    const incoming = { id: 2, location_id: 2, location_name: 'Other store', message: 'New incoming', user_name: 'Staff', created_at: new Date().toISOString() };
    await page.evaluate(message => window.probeStreams.at(-1).onmessage({ data: JSON.stringify({ messages: [message] }) }), incoming);
    await page.waitForFunction(() => window.probeSounds === 1);
    await page.evaluate(message => window.probeStreams.at(-1).onmessage({ data: JSON.stringify({ messages: [message, { ...message, id: 3, location_id: 1 }] }) }), incoming);
    if (await page.evaluate(() => window.probeSounds) !== 1) throw new Error('Replay or own message played sound');
    if (errors.length) throw new Error(errors.join('; '));
    console.log('PASS: real POS component images/details, size order in both lists, pasted image, one sound for new incoming only; no sales, stock or messages written');

    const authContext = await browser.newContext({ baseURL: 'http://localhost:3037', viewport: { width: 1440, height: 1000 } });
    const loginResponse = await authContext.request.post('/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    const login = await loginResponse.json();
    if (!loginResponse.ok() || !login.success || login.requiresMfa) throw new Error('Sandbox login unavailable or requires human MFA');
    const identity = await (await authContext.request.get('/api/user/me')).json();
    if (identity.businessId !== process.env.LIVE_E2E_EXPECTED_BUSINESS_ID) throw new Error('Unexpected sandbox identity');
    await authContext.addInitScript(() => {
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      for (let locationId = 1; locationId <= 30; locationId++) localStorage.setItem(`pos_daybook_staff_${locationId}_${date}`, JSON.stringify({ id: null, name: 'Browser check', initials: 'BC' }));
    });
    const daybook = await authContext.newPage();
    await daybook.route('**/api/pos/daybook*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await daybook.goto('/ims');
    await daybook.getByTestId('ims-nav-__locations').click();
    await daybook.getByTestId('ims-nav-location-daybooks').click();
    await daybook.getByRole('button', { name: /Open Daybook/ }).first().click();
    await daybook.getByRole('table').waitFor();
    if (await daybook.getByRole('table').getByRole('button', { name: /comment/i }).count() || await daybook.getByRole('table').getByText('Comments', { exact: true }).count()) throw new Error('Daily task comments still present');
    await daybook.screenshot({ path: 'tmp/support-daybook-desktop.png', fullPage: true });
    await daybook.setViewportSize({ width: 390, height: 844 });
    await daybook.screenshot({ path: 'tmp/support-daybook-mobile.png', fullPage: true });
    console.log('PASS: authenticated sandbox Daybook checklist has no task comment threads or controls on desktop/mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });