import { accountLabel, accountName } from './account-name';

/// The name rules are the same on every screen and in every file, so they get
/// one place that checks them.
describe('accountName', () => {
  const account = {
    code: '1101',
    nameEn: 'Cash on hand',
    nameAr: 'النقدية بالصندوق',
  };

  it('shows the Arabic name in Arabic', () => {
    expect(accountName(account, 'ar')).toBe('النقدية بالصندوق');
  });

  it('shows the English name in English', () => {
    expect(accountName(account, 'en')).toBe('Cash on hand');
  });

  it('falls back to the other language when the preferred one is missing', () => {
    expect(accountName({ ...account, nameAr: '' }, 'ar')).toBe('Cash on hand');
    expect(accountName({ ...account, nameEn: null }, 'en')).toBe(
      'النقدية بالصندوق',
    );
  });

  it('falls back to the code when both names are missing', () => {
    expect(
      accountName({ code: '9999', nameEn: '', nameAr: null }, 'ar'),
    ).toBe('9999');
    expect(
      accountName({ code: '9999', nameEn: null, nameAr: '   ' }, 'en'),
    ).toBe('9999');
  });

  it('builds a label with the code first', () => {
    expect(accountLabel(account, 'ar')).toBe('1101 — النقدية بالصندوق');
  });
});
