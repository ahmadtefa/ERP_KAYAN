import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetRolePermissionsDto } from './dto/role.dto';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

const role = {id:'role-id',companyId:'company-id',isSystem:false,deletedAt:null};
function setup(current: string[] = ['sales.read']) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{id:role.id}]),
    role: {findFirst:jest.fn().mockResolvedValue(role)},
    rolePermission:{
      findMany:jest.fn().mockResolvedValue(current.map(code => ({permission:{code}}))),
      deleteMany:jest.fn().mockResolvedValue({}),
      create:jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    role:{findFirst:jest.fn().mockResolvedValue({...role,rolePermissions:[],_count:{userRoles:0}})},
    permission:{findMany:jest.fn().mockImplementation(async ({where}) => where.code.in.map((code:string)=>({id:code,code})))},
    $transaction:jest.fn().mockImplementation(async (fn) => fn(tx)),
  };
  const audit={recordRequired:jest.fn().mockResolvedValue(undefined)};
  return {service:new RolesService(prisma as any,audit as any),prisma,tx,audit};
}

describe('role permission replacement safety', () => {
  it('refuses stale sets under a role lock without deleting grants', async () => {
    const {service,tx,audit}=setup(['sales.read','sales.write']);
    await expect(service.setPermissions('company-id','actor','role-id',['sales.read'],[],true,['sales.read']))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(audit.recordRequired).not.toHaveBeenCalled();
  });
  it('accepts the same set in a different order and records mandatory audit inside the transaction', async () => {
    const {service,tx,audit}=setup(['sales.read','sales.write']);
    await service.setPermissions('company-id','actor','role-id',['sales.read'],[],true,['sales.write','sales.read']);
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      action:'role.permissions_set',before:{permissions:['sales.read','sales.write']},after:{permissions:['sales.read']},
    }),tx);
  });
  it('propagates mandatory audit failure to roll back the transaction', async () => {
    const {service,audit}=setup();
    audit.recordRequired.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.setPermissions('company-id','actor','role-id',['sales.read'],[],true,['sales.read']))
      .rejects.toThrow('audit unavailable');
  });
  it('keeps old-client compatibility when the expected set is omitted', async () => {
    const {service,tx}=setup();
    await service.setPermissions('company-id','actor','role-id',[],[],true);
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledTimes(1);
  });
  it('controller forwards the expected set without weakening the permission gate', async () => {
    const service={setPermissions:jest.fn().mockResolvedValue({})};
    const controller=new RolesController(service as any);
    const actor={companyId:'company-id',userId:'actor',permissions:['admin.roles.manage'],isSuperAdmin:false};
    await controller.setPermissions(actor as any,'role-id',{permissions:['sales.read'],expectedPermissions:['sales.write']});
    expect(service.setPermissions).toHaveBeenCalledWith('company-id','actor','role-id',['sales.read'],['admin.roles.manage'],false,['sales.write']);
  });
  it('accepts omission or an empty expected set but rejects null or malformed input', async () => {
    for (const body of [{permissions:[]},{permissions:[],expectedPermissions:[]}]) {
      expect(await validate(plainToInstance(SetRolePermissionsDto,body),{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);
    }
    for (const value of [null,'bad',[123],['same','same']]) {
      const errors=await validate(plainToInstance(SetRolePermissionsDto,{permissions:[],expectedPermissions:value}),{whitelist:true,forbidNonWhitelisted:true});
      expect(errors.map(e=>e.property)).toContain('expectedPermissions');
    }
  });
});
