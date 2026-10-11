import { BadRequestException } from '@nestjs/common';

import { LOGO_MAX_BYTES, validateLogo } from './company.service';

/// The logo rules protect the database from whatever someone uploads.
describe('validateLogo', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(16),
  ]);
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP'),
    Buffer.alloc(8),
  ]);

  it('accepts a real PNG', () => {
    expect(validateLogo(png, 'image/png').mime).toBe('image/png');
  });

  it('accepts a real JPEG', () => {
    expect(validateLogo(jpeg, 'image/jpeg').mime).toBe('image/jpeg');
  });

  it('accepts a real WebP', () => {
    expect(validateLogo(webp, 'image/webp').mime).toBe('image/webp');
  });

  it('refuses a type outside the list', () => {
    expect(() => validateLogo(png, 'image/svg+xml')).toThrow(
      BadRequestException,
    );
    expect(() => validateLogo(png, 'text/html')).toThrow(BadRequestException);
  });

  it('refuses bytes that do not match the claimed type', () => {
    const script = Buffer.from('<script>alert(1)</script>');
    expect(() => validateLogo(script, 'image/png')).toThrow(BadRequestException);
    expect(() => validateLogo(script, 'image/jpeg')).toThrow(BadRequestException);
  });

  it('refuses an empty file and an oversized one', () => {
    expect(() => validateLogo(Buffer.alloc(0), 'image/png')).toThrow(
      BadRequestException,
    );
    const big = Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(() => validateLogo(big, 'image/png')).toThrow(BadRequestException);
  });

  it('refuses a RIFF container that is not really WebP', () => {
    const fake = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
      Buffer.alloc(8),
    ]);
    expect(() => validateLogo(fake, 'image/webp')).toThrow(BadRequestException);
  });
});
