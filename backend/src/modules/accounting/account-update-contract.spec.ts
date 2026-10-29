import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

/// The chart-of-accounts bug, pinned at the contract.
///
/// The Flutter client sent the whole account on `PATCH
/// /accounting/chart-of-accounts/:id`, including `type`. `UpdateAccountDto`
/// has no `type` — an account's type is fixed once it exists — and the global
/// ValidationPipe runs with `whitelist: true, forbidNonWhitelisted: true`, so
/// the whole request was refused:
///
///     400 {"detail": "property type should not exist"}
///
/// The client now sends only what the operation changes. These tests keep the
/// contract honest from the server side: `type` must stay out of an update,
/// unknown properties must keep being refused (the fix must never be "turn
/// the pipe off"), and the fields the client does send must be accepted.
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

const updateBody = (extra: Record<string, unknown> = {}) => ({
  code: '1104',
  nameEn: 'Inventory',
  nameAr: 'المخزون',
  parentId: '6f1d4b3a-2c1e-4a53-9a2b-1f0e5c7d8a11',
  isPostable: true,
  isActive: false,
  ...extra,
});

async function errorsFor<T extends object>(
  dto: new () => T,
  body: Record<string, unknown>,
) {
  const instance = plainToInstance(dto, body);
  return validate(instance, PIPE_OPTIONS);
}

describe('chart-of-accounts update contract', () => {
  it('refuses the payload that broke deactivation: `type` does not exist', async () => {
    const errors = await errorsFor(UpdateAccountDto, updateBody({ type: 'ASSET' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('type');
    expect(errors[0].constraints).toEqual({
      whitelistValidation: 'property type should not exist',
    });
  });

  it('accepts the corrected deactivation payload (flag only)', async () => {
    const errors = await errorsFor(UpdateAccountDto, { isActive: false });
    expect(errors).toHaveLength(0);
  });

  it('accepts the corrected edit payload, which omits `type`', async () => {
    const errors = await errorsFor(UpdateAccountDto, updateBody());
    expect(errors).toHaveLength(0);
  });

  it('keeps refusing any other unknown property', async () => {
    const errors = await errorsFor(
      UpdateAccountDto,
      updateBody({ bogusField: 1 }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.whitelistValidation).toBe(
      'property bogusField should not exist',
    );
  });

  it('still rejects a wrongly typed flag', async () => {
    const errors = await errorsFor(UpdateAccountDto, {
      isActive: 'nope' as unknown as boolean,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('isActive');
  });

  it('still rejects a parent id that is not a UUID', async () => {
    const errors = await errorsFor(UpdateAccountDto, {
      parentId: 'not-a-uuid',
    });

    expect(errors.map((e) => e.property)).toContain('parentId');
  });

  it('creation still accepts and needs `type`', async () => {
    const withType = await errorsFor(CreateAccountDto, {
      code: '1104',
      nameEn: 'Inventory',
      nameAr: 'المخزون',
      type: 'ASSET',
    });
    expect(withType).toHaveLength(0);

    const badType = await errorsFor(CreateAccountDto, {
      code: '1104',
      nameEn: 'Inventory',
      nameAr: 'المخزون',
      type: 'CAPITAL',
    });
    expect(badType.map((e) => e.property)).toContain('type');
  });

  it('the update contract never grows a `type` field', () => {
    // A DTO property would accept the field instead of refusing it, and the
    // bug would come back the moment the client sent the old payload again.
    const keys = Object.keys(plainToInstance(UpdateAccountDto, { isActive: false }));
    expect(keys).toContain('isActive');
    expect(keys).not.toContain('type');
  });
});
