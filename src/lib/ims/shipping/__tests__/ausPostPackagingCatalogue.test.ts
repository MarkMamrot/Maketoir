import { describe, expect, it } from 'vitest';

import { AUSPOST_PACKAGING_CATALOGUE, getAusPostPackagingPresets } from '../ausPostPackagingCatalogue';

describe('Australia Post packaging catalogue', () => {
  it('converts centimetres to millimetres and retains corrected decimal box depths', () => {
    expect(AUSPOST_PACKAGING_CATALOGUE).toHaveLength(35);
    expect(getAusPostPackagingPresets(['mailing-box-bx1', 'mailing-box-bx19', 'video-dvd-bx6']))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ catalogueId: 'mailing-box-bx1', heightMm: 77 }),
        expect.objectContaining({ catalogueId: 'mailing-box-bx19', heightMm: 70 }),
        expect.objectContaining({ catalogueId: 'video-dvd-bx6', heightMm: 35 }),
      ]));
  });

  it('ignores unknown IDs instead of accepting browser-supplied package data', () => {
    expect(getAusPostPackagingPresets(['satchel-500g-ep-pp', 'made-up-package']).map(item => item.catalogueId))
      .toEqual(['satchel-500g-ep-pp']);
  });
});