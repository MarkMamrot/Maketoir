import { describe, expect, it } from 'vitest';
import { readSupportTicketSubmission, supportImagePath, validateSupportImage } from '../supportTicketImages';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe('support ticket images', () => {
  it('validates content rather than trusting MIME type', () => {
    expect(validateSupportImage({ size: png.length, type: 'image/png' }, png).extension).toBe('.png');
    expect(() => validateSupportImage({ size: png.length, type: 'image/jpeg' }, png)).toThrow('Only JPEG');
    expect(() => validateSupportImage({ size: 6 * 1024 * 1024, type: 'image/png' }, png)).toThrow('5 MB');
  });
  it('rejects path traversal and invalid ticket ids', () => {
    expect(() => supportImagePath(1, '../image.png')).toThrow();
    expect(() => supportImagePath(-1, '12345678-1234-1234-1234-123456789abc.png')).toThrow();
  });
  it('accepts multipart images and retains description', async () => {
    const form = new FormData();
    form.set('subject', 'Screenshot');
    form.set('description', 'This is the error');
    form.append('images', new File([png], 'image.png', { type: 'image/png' }));
    const parsed = await readSupportTicketSubmission(new Request('http://localhost', { method: 'POST', body: form }));
    expect(parsed.description).toBe('This is the error');
    expect(parsed.images).toHaveLength(1);
  });
  it('rejects more than five images', async () => {
    const form = new FormData();
    form.set('subject', 'Screenshot');
    form.set('description', 'Error');
    for (let index = 0; index < 6; index++) form.append('images', new File([png], 'image.png', { type: 'image/png' }));
    await expect(readSupportTicketSubmission(new Request('http://localhost', { method: 'POST', body: form }))).rejects.toThrow('five');
  });
});