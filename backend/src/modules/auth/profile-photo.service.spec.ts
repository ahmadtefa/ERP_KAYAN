import sharp from 'sharp';
import { ProfilePhotoService } from './profile-photo.service';

describe('self profile photo', () => {
  const company = 'company', user = 'user';
  let stored: {companyId:string;data:Uint8Array;mime:string} | null;
  let failAudit: boolean;
  let auditRows: unknown[];
  let service: ProfilePhotoService;
  let png: Buffer;
  beforeEach(async () => {
    stored = null; failAudit = false; auditRows = [];
    png = await sharp({create:{width:32,height:32,channels:3,background:'#b7d8a0'}}).png().toBuffer();
    const prisma = {
      userProfilePhoto:{findFirst:jest.fn(async ({where}:{where:{companyId:string;userId:string}}) =>
        where.companyId === company && where.userId === user ? stored : null)},
      $transaction:jest.fn(async (work:(tx:unknown)=>Promise<void>) => {
        let staged = stored;
        const tx = {
          $queryRaw:jest.fn(async (...args:unknown[]) => args.includes(company) && args.includes(user) ? [{id:user}] : []),
          userProfilePhoto:{
            findUnique:jest.fn(async () => staged ? {companyId:staged.companyId} : null),
            upsert:jest.fn(async ({create,update}:{create:{companyId:string;data:Uint8Array;mime:string};update:{data:Uint8Array;mime:string}}) => { staged = staged ? {...staged,...update} : create; }),
            deleteMany:jest.fn(async ({where}:{where:{companyId:string;userId:string}}) => {
              if (where.companyId !== company || where.userId !== user || !staged) return {count:0};
              staged = null; return {count:1};
            }),
          },
        };
        await work(tx);
        stored = staged;
      }),
    };
    const audit = {recordRequired:jest.fn(async (input:unknown) => {
      if (failAudit) throw new Error('audit failed'); auditRows.push(input);
    })};
    service = new ProfilePhotoService(prisma as never,audit as never);
  });

  it('persists, reads and deletes only the current user photo without auditing its bytes', async () => {
    await service.set(company,user,png,'image/png');
    const photo = await service.get(company,user);
    expect(photo.mime).toBe('image/webp'); expect(photo.data).toBeTruthy();
    expect(await service.get('other',user)).toEqual({mime:null,data:null});
    expect(await service.get(company,'other')).toEqual({mime:null,data:null});
    expect(JSON.stringify(auditRows)).not.toContain(photo.data!);
    await service.remove(company,user);
    expect(await service.get(company,user)).toEqual({mime:null,data:null});
    expect(auditRows).toHaveLength(2);
  });

  it('rolls back writes and removals when required audit fails, and rejects invalid photos', async () => {
    await expect(service.set(company,user,Buffer.from('not an image'),'image/png')).rejects.toThrow();
    expect(await service.get(company,user)).toEqual({mime:null,data:null});
    failAudit = true;
    await expect(service.set(company,user,png,'image/png')).rejects.toThrow('audit failed');
    expect(await service.get(company,user)).toEqual({mime:null,data:null});
    failAudit = false;
    await service.set(company,user,png,'image/png');
    const before = await service.get(company,user);
    const replacement = await sharp({create:{width:32,height:32,channels:3,background:'#1030c0'}}).png().toBuffer();
    failAudit = true;
    await expect(service.set(company,user,replacement,'image/png')).rejects.toThrow('audit failed');
    await expect(service.remove(company,user)).rejects.toThrow('audit failed');
    expect(await service.get(company,user)).toEqual(before);
    await expect(service.set('other',user,png,'image/png')).rejects.toThrow('User not found');
  });
});
