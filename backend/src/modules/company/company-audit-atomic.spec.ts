import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyService } from './company.service';

describe('company mutations with required transactional audit', () => {
  let dir: string;
  const originalUploadDir = process.env.KAYAN_UPLOAD_DIR;
  let row: Record<string, unknown>;
  let auditRows: unknown[];
  let failAudit: boolean;
  let service: CompanyService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kayan-company-audit-test-'));
    process.env.KAYAN_UPLOAD_DIR = dir;
    await writeFile(join(dir, 'old-logo.png'), 'legacy fixture');
    row = { id: 'company', code: 'KAYAN', nameEn: 'Before', nameAr: 'قبل',
      deletedAt: null, logoPath: 'old-logo.png', logoData: null, logoMime: null,
      updatedAt: new Date(), currency: 'EGP', timezone: 'Africa/Cairo', isActive: true };
    auditRows = [];
    failAudit = false;
    const company = {
      findUnique: jest.fn(async () => ({ ...row })),
      findFirst: jest.fn(async () => null),
    };
    const prisma = {
      company,
      $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        let pending = { ...row };
        const pendingAudit: unknown[] = [];
        const tx = {
          company: {
            findUnique: async () => ({ ...pending }),
            findFirst: async () => null,
            update: async ({ data }: { data: Record<string, unknown> }) => {
              pending = { ...pending, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
              return { ...pending };
            },
          },
          auditLog: { create: async ({ data }: { data: unknown }) => {
            if (failAudit) throw new Error('synthetic audit failure');
            pendingAudit.push(data);
          } },
        };
        const result = await work(tx);
        row = pending;
        auditRows.push(...pendingAudit);
        return result;
      }),
    } as unknown as PrismaService;
    service = new CompanyService(prisma, new AuditService(prisma));
  });

  afterEach(async () => {
    if (originalUploadDir === undefined) delete process.env.KAYAN_UPLOAD_DIR;
    else process.env.KAYAN_UPLOAD_DIR = originalUploadDir;
    await rm(dir, { recursive: true, force: true });
  });

  for (const action of ['profile', 'upload', 'delete'] as const) {
    it(`${action}: an audit failure rolls back the company and keeps legacy file`, async () => {
      failAudit = true;
      const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
      const operation = action === 'profile'
        ? service.updateProfile('company', 'actor', { nameEn: 'After' })
        : action === 'upload'
          ? service.setLogo('company', 'actor', png, 'image/png')
          : service.deleteLogo('company', 'actor');
      await expect(operation).rejects.toThrow('synthetic audit failure');
      expect(row.nameEn).toBe('Before');
      expect(row.logoPath).toBe('old-logo.png');
      expect(row.logoData).toBeNull();
      expect(auditRows).toHaveLength(0);
      expect(await readFile(join(dir, 'old-logo.png'), 'utf8')).toBe('legacy fixture');
    });
  }

  it('commits profile and redacted audit together', async () => {
    await service.updateProfile('company', 'actor', { nameEn: 'After' });
    expect(row.nameEn).toBe('After');
    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows)).not.toContain('logoData');
    expect((auditRows[0] as { afterJson: { updatedAt: unknown } }).afterJson.updatedAt).toEqual(expect.any(String));
    expect(auditRows[0]).toMatchObject({ companyId: 'company', userId: 'actor', action: 'UPDATE' });
  });

  it('removes legacy logo only after the audited delete commits', async () => {
    await service.deleteLogo('company', 'actor');
    expect(row.logoPath).toBeNull();
    expect(auditRows).toHaveLength(1);
    expect(existsSync(join(dir, 'old-logo.png'))).toBe(false);
  });
});
