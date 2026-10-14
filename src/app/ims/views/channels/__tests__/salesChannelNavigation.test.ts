import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'ims', 'page.tsx'), 'utf8');
const navigation = source.slice(source.indexOf('const NAV = ['), source.indexOf('] as const;', source.indexOf('const NAV = [')));

describe('Sales Channels sidebar destination', () => {
  it('keeps Sales Channels and the native Online Shop in Sales without an Integrations group', () => {
    const sales = navigation.slice(navigation.indexOf("id: '__sales'"), navigation.indexOf("id: '__purchasing'"));
    expect(sales).toContain("id: 'sales-channels'");
    expect(sales).toContain("id: 'online-shop'");
    expect(navigation).not.toContain("id: '__integrations'");
    expect(navigation.match(/id: 'sales-channels'/g)).toHaveLength(1);
  });

  it('preserves Xero under Finances', () => {
    const finances = navigation.slice(navigation.indexOf("id: '__finances'"));
    expect(finances).toContain("id: 'xero'");
  });
});
