import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

describe('LicensingController safe status', () => {
  const damagedStateError = Object.assign(
    new Error('Protected licence state is damaged'),
    { response: { code: 'LICENSE_STATE_DAMAGED' } },
  );

  it('returns an explicitly blocked diagnostic status for a damaged protected state', async () => {
    const licensing = {
      status: jest.fn().mockRejectedValue(damagedStateError),
    } as unknown as LicensingService;
    const controller = new LicensingController(licensing);

    await expect(controller.status()).resolves.toMatchObject({
      state: 'UNLICENSED',
      stateError: 'LICENSE_STATE_DAMAGED',
      blocked: true,
      enforcement: 'enforce',
      configured: false,
      requestCode: '',
    });
  });

  it('does not hide unrelated status failures', async () => {
    const failure = new Error('database unavailable');
    const licensing = {
      status: jest.fn().mockRejectedValue(failure),
    } as unknown as LicensingService;
    const controller = new LicensingController(licensing);

    await expect(controller.status()).rejects.toBe(failure);
  });

  it('returns the normal status unchanged when the protected state is readable', async () => {
    const status = {
      state: 'ACTIVE',
      blocked: false,
      enforcement: 'enforce',
      configured: true,
    };
    const licensing = {
      status: jest.fn().mockResolvedValue(status),
    } as unknown as LicensingService;
    const controller = new LicensingController(licensing);

    await expect(controller.status()).resolves.toBe(status);
  });
});
