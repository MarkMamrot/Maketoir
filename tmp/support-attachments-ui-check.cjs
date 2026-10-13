const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
require('dotenv').config({ quiet: true });

async function bundle() {
  const filename = 'src/app/pos/components/daybook/PosStoreDaybook.tsx';
  const source = fs.readFileSync(filename, 'utf8');
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
    }
  }
  const selected = new Set();
  const referenced = new Set();
  function include(name) {
    referenced.add(name);
    const declaration = declarations.get(name);
    if (!declaration || selected.has(declaration)) return;
    selected.add(declaration);
    function visit(node) { if (ts.isIdentifier(node)) include(node.text); ts.forEachChild(node, visit); }
    ts.forEachChild(declaration, visit);
  }
  include('CommunicationsView');
  const imports = tree.statements.filter(statement => ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly && statement.importClause && (() => {
    const bindings = statement.importClause.namedBindings;
    return referenced.has(statement.importClause.name?.text) || (bindings && ts.isNamedImports(bindings) && bindings.elements.some(element => referenced.has(element.name.text)));
  })()).map(statement => statement.getText(tree)).join('\n');
  const code = `import React from 'react'; import { createRoot } from 'react-dom/client';
    ${imports}
    ${[...selected].map(statement => statement.getText(tree)).join('\n')}
    const existing={id:4,original_name:'original.png',mime_type:'image/png',file_size:4};
    const initial={id:3,title:'Fixture notice',message:'Fixture notice',priority:'normal',published_at:'2026-10-13T03:00:00Z',can_edit:true,readers:[],my_read:1,comments:[],attachments:[existing]};
    window.probe={creates:0,saves:[],failNext:false};
    function Probe(){const[workspace,setWorkspace]=useState({location:{id:2,name:'Store'},locations:[{id:2,name:'Store'}],permissions:{manager:true},communications:[initial]});
      async function perform(action,payload){if(action==='create_communication'){window.probe.creates++;const item={...initial,id:30,...payload,attachments:[]};setWorkspace(current=>({...current,communications:[item,...current.communications]}));return{id:30};}return{success:true};}
      async function saveAttachments(id,attachments,files,originalIds){if(window.probe.failNext){window.probe.failNext=false;throw new Error('Fixture upload failure');}window.probe.saves.push({id,retained:attachments.map(file=>file.id),files:files.map(file=>file.name),originalIds});setWorkspace(current=>({...current,communications:current.communications.map(item=>item.id===id?{...item,attachments:[...attachments,...files.map((file,index)=>({id:10+index,original_name:file.name,mime_type:file.type,file_size:file.size}))]}:item)}));}
      return <main className={styles.shell+' '+styles.theme_evergreen} style={{padding:16}}><CommunicationsView workspace={workspace} saving={false} perform={perform} onSaveAttachments={saveAttachments} attachmentUrl={()=>'/original.png'}/></main>;}
    createRoot(document.getElementById('probe')).render(<Probe/>);`;
  const result = await esbuild.build({ stdin: { contents: code, loader: 'tsx', resolveDir: path.dirname(path.resolve(filename)) }, bundle: true, write: false, outdir: 'tmp/support-attachments-probe', format: 'iife', jsx: 'transform', define: { 'process.env.NODE_ENV': '"production"' } });
  return { script: result.outputFiles.find(file => file.path.endsWith('.js')).text, css: result.outputFiles.find(file => file.path.endsWith('.css')).text };
}

(async () => {
  const assets = await bundle();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const image = fs.readFileSync('public/avatars/l1_base_boy_1.png');
    await page.route('https://attachment-probe.local/**', route => route.request().url().endsWith('/original.png')
      ? route.fulfill({ contentType: 'image/png', body: image })
      : route.fulfill({ contentType: 'text/html', body: '<html><head></head><body style="margin:0"><div id="probe"></div></body></html>' }));
    await page.goto('https://attachment-probe.local');
    await page.addStyleTag({ content: '*,:before,:after{box-sizing:border-box}' + assets.css });
    await page.addScriptTag({ content: assets.script });
    await page.getByRole('button', { name: 'Communication actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    assert(await page.getByRole('img', { name: 'original.png' }).evaluate(image => image.complete && image.naturalWidth > 0));
    await page.getByRole('button', { name: 'Remove original.png' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: image });
    await page.getByRole('img', { name: 'replacement.png' }).waitFor();
    assert(await page.getByRole('img', { name: 'replacement.png' }).evaluate(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'tmp/support-attachments-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: 'tmp/support-attachments-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.probe.saves.length === 1);
    assert.deepEqual(await page.evaluate(() => window.probe.saves[0]), { id: 3, retained: [], files: ['replacement.png'], originalIds: [4] });
    await page.getByRole('button', { name: 'Add new', exact: true }).click();
    await page.locator('[contenteditable=true]').fill('New fixture notice');
    await page.locator('input[type=file]').setInputFiles({ name: 'before-post.png', mimeType: 'image/png', buffer: image });
    await page.getByRole('img', { name: 'before-post.png' }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'preview.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    assert((await page.getByRole('link', { name: 'Preview preview.pdf' }).getAttribute('href')).startsWith('blob:'));
    await page.evaluate(() => { window.probe.failNext = true; });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Fixture upload failure' }).waitFor();
    assert.equal(await page.evaluate(() => window.probe.creates), 1);
    assert.equal(await page.getByRole('img', { name: 'before-post.png' }).count(), 1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.probe.saves.length === 2);
    assert.equal(await page.evaluate(() => window.probe.creates), 1);
    assert.deepEqual(await page.evaluate(() => window.probe.saves[1].files), ['before-post.png', 'preview.pdf']);
    assert.deepEqual(errors, []);
    console.log('PASS: actual communication editor previews existing/new images and PDFs, removes/replaces saved files, fits desktop/mobile, retains a failed draft and retries without duplicate publication. No live notices changed.');
    const authenticated = await browser.newContext({ baseURL: 'http://localhost:3041', viewport: { width: 1440, height: 950 } });
    const loginResponse = await authenticated.request.post('/api/auth/login', { data: { email: process.env.LIVE_E2E_ADMIN_EMAIL, password: process.env.LIVE_E2E_ADMIN_PASSWORD, destination: 'ims' } });
    const login = await loginResponse.json();
    if (!loginResponse.ok() || !login.success || login.requiresMfa) throw new Error('Sandbox login unavailable or requires human MFA');
    const identity = await (await authenticated.request.get('/api/user/me')).json();
    if (identity.businessId !== process.env.LIVE_E2E_EXPECTED_BUSINESS_ID) throw new Error('Unexpected sandbox identity');
    await authenticated.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (key.startsWith('pos_daybook_staff_')) return JSON.stringify({ id: 909, name: 'Browser check', initials: 'BC' });
        return getItem.call(this, key);
      };
    });
    const actual = await authenticated.newPage();
    const requests = [];
    let postedAttachment;
    const fixtureNotice = { id: 77, title: 'Fixture notice', message: 'Fixture notice', priority: 'normal', published_at: '2026-10-13T03:00:00Z', can_edit: true, readers: [], my_read: 1, comments: [], attachments: [{ id: 55, original_name: 'original.png', mime_type: 'image/png', file_size: image.length }] };
    await actual.route('**/api/pos/daybook*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.includes('/attachments/')) return route.fulfill({ contentType: 'image/png', body: image });
      if (request.method() === 'GET') return route.fulfill({ json: { date: new Date().toLocaleDateString('en-CA'), location: { id: Number(url.searchParams.get('location_id') || 1), name: 'Fixture store' }, permissions: { manager: true, editPolicy: 'managers' }, preferences: { theme: 'evergreen', showInMainMenu: false, hourlyReminder: false }, tasks: [], taskHistory: [], taskDates: [], records: [], references: [], referenceCategories: [], guides: [], staff: [], locations: [], communications: [fixtureNotice] } });
      if (request.method() === 'POST' && url.pathname === '/api/pos/daybook') {
        const data = request.postDataJSON();
        if (data.action === 'save_identity') return route.fulfill({ json: { success: true, staff: { id: 909, name: 'Browser check', initials: 'BC' } } });
        assert.equal(data.action, 'update_communication');
        requests.push(data);
        return route.fulfill({ json: { success: true } });
      }
      if (request.method() === 'PUT' && url.pathname === '/api/pos/daybook/attachments') {
        const formData = await new Request('http://fixture/attachments', { method: 'PUT', headers: { 'Content-Type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
        const files = formData.getAll('files');
        postedAttachment = { id: formData.get('communication_id'), retained: JSON.parse(formData.get('retained_attachment_ids')), original: JSON.parse(formData.get('original_attachment_ids')), staff: formData.get('staff_initials'), location: Number(formData.get('location_id')), files: files.map(file => file.name), bytes: Buffer.from(await files[0].arrayBuffer()) };
        fixtureNotice.attachments = [{ id: 56, original_name: 'replacement.png', mime_type: 'image/png', file_size: image.length }];
        return route.fulfill({ json: { success: true } });
      }
      return route.abort();
    });
    await actual.goto('/ims');
    await actual.getByTestId('ims-nav-__locations').click();
    await actual.getByTestId('ims-nav-location-daybooks').click();
    await actual.getByRole('button', { name: /Open Daybook/ }).first().click();
    const staffDialog = actual.getByRole('dialog', { name: 'Who is using the Daybook?' });
    if (await staffDialog.isVisible()) {
      await staffDialog.getByLabel('Name', { exact: true }).fill('Browser check');
      await staffDialog.getByLabel('Initials', { exact: true }).fill('BC');
      await staffDialog.getByRole('button', { name: 'Continue as this staff member' }).click();
      await staffDialog.waitFor({ state: 'hidden' });
    }
    await actual.getByRole('button', { name: 'Comms', exact: true }).click();
    await actual.getByRole('button', { name: 'Communication actions' }).click();
    await actual.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await actual.getByRole('button', { name: 'Remove original.png' }).click();
    await actual.locator('input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: image });
    assert(await actual.getByRole('img', { name: 'replacement.png' }).evaluate(image => image.complete && image.naturalWidth > 0));
    await actual.screenshot({ path: 'tmp/support-attachments-auth-desktop.png', fullPage: true });
    await actual.setViewportSize({ width: 390, height: 844 });
    await actual.screenshot({ path: 'tmp/support-attachments-auth-mobile.png', fullPage: true });
    await actual.getByRole('button', { name: 'Save', exact: true }).click();
    await actual.getByRole('button', { name: 'Communication actions' }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal(postedAttachment.id, '77');
    assert.deepEqual(postedAttachment.retained, []);
    assert.deepEqual(postedAttachment.original, [55]);
    assert.equal(postedAttachment.staff, 'BC');
    assert(postedAttachment.location > 0);
    assert.deepEqual(postedAttachment.files, ['replacement.png']);
    assert.deepEqual(postedAttachment.bytes, image);
    console.log('PASS: authenticated IMS Daybook renders previews and submits the correct replacement bytes, retained/original IDs, staff identity and location through the full client. All notice and attachment writes intercepted.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });