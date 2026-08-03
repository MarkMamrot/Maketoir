import { describe, expect, it } from 'vitest';
import { dedupeProductPhotoUrls } from '../productPhotoCandidates';

describe('dedupeProductPhotoUrls', () => {
  it('shows the same image path only once across sources and resize queries', () => {
    expect(dedupeProductPhotoUrls([
      'https://cdn.example.com/products/skirt.jpg?width=300',
      'https://cdn.example.com/products/skirt.jpg?width=1200',
      'https://cdn.example.com/products/skirt.jpg?width=300',
    ])).toEqual(['https://cdn.example.com/products/skirt.jpg?width=300']);
  });

  it('keeps distinct image paths and ignores invalid candidates', () => {
    expect(dedupeProductPhotoUrls([
      '',
      'not-a-url',
      'https://cdn.example.com/products/front.jpg',
      'https://cdn.example.com/products/back.jpg',
    ])).toEqual([
      'https://cdn.example.com/products/front.jpg',
      'https://cdn.example.com/products/back.jpg',
    ]);
  });
});