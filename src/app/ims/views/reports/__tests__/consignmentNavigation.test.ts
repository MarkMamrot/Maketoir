import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'ims', 'page.tsx'), 'utf8');
const reports = page.slice(page.indexOf('const REPORT_CATALOG = ['), page.indexOf('function CashBankingReportView('));

describe('consignment navigation wiring', () => {
  it('includes Consignment Activity in the Reports overview with a loaded business-feature guard', () => {
    expect(reports).toContain("id: 'report-consignment-activity'");
    expect(reports).toContain("title: 'Consignment Activity'");
    expect(reports).toContain('const { settings, loaded } = useFeatureToggles();');
    expect(reports).toContain('loaded && isFeatureViewEnabled(settings, report.id)');
    expect(reports).toContain('onClick={() => onNav(r.id)}');
  });

  it('uses Consignment Statements consistently and gates supplier shortcuts', () => {
    expect(page).toContain("{ id: 'consignment-statements', label: 'Consignment Statements' }");
    expect(page).not.toContain('Consignment Statement History');
    expect(page).toContain('consignmentsEnabled && Number(f.is_consignment) === 1');
  });

  it('keeps disabled saved destinations and unloaded screens behind the shared feature guard', () => {
    expect(page).toContain('!settingsLoaded || isFeatureViewEnabled(pageSettings, view)');
    expect(page).toContain('!settingsLoaded || !isFeatureViewEnabled(pageSettings, view)');
    expect(page).toContain('window.history.replaceState(window.history.state, \'\', \'#dashboard\')');
  });
});
