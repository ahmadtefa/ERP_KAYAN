import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

const target={id:'user-id',companyId:'company-id',username:'synthetic-user',fullNameEn:'Synthetic',fullNameAr:'تجريبي',
  isActive:true,isSuperAdmin:false,createdAt:new Date(),userRoles:[],branches:[],userPermissions:[]};
function setup({roles=['role-1'],permissions=['synthetic.read']} = {}) {
  const tx={
    user:{update:jest.fn().mockResolvedValue(target)},
    userRole:{findMany:jest.fn().mockResolvedValue(roles.map(roleId=>({roleId}))),deleteMany:jest.fn().mockResolvedValue({})},
    userPermission:{findMany:jest.fn().mockResolvedValue(permissions.map(code=>({permission:{code}}))),deleteMany:jest.fn().mockResolvedValue({})},
    refreshToken:{updateMany:jest.fn().mockResolvedValue({})},
  };
  const prisma={user:{findFirst:jest.fn().mockResolvedValue(target)},
    $transaction:jest.fn().mockImplementation(async (fn)=>fn(tx))};
  const audit={record:jest.fn().mockResolvedValue(undefined)};
  const service=new UsersService(prisma as any,audit as any,{} as any);
  return {service,tx,audit};
}

describe('user role and extra grant replacement safety', () => {
  it('refuses stale roles before replacing them', async () => {
    const {service,tx}=setup();
    await expect(service.update('company-id','actor','user-id',{roleIds:[],expectedRoleIds:[]},[],true)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses stale extra grants before replacing them', async () => {
    const {service,tx}=setup();
    await expect(service.update('company-id','actor','user-id',{extraPermissions:[],expectedExtraPermissions:[]},[],true)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.userPermission.deleteMany).not.toHaveBeenCalled();
  });
  it('replaces both sets when the snapshots match and keeps the old-client path', async () => {
    const {service,tx}=setup();
    await service.update('company-id','actor','user-id',{
      roleIds:[],expectedRoleIds:['role-1'],extraPermissions:[],expectedExtraPermissions:['synthetic.read'],
    },[],true);
    expect(tx.userRole.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.userPermission.deleteMany).toHaveBeenCalledTimes(1);
    await service.update('company-id','actor','user-id',{roleIds:[]},[],true);
    expect(tx.userRole.deleteMany).toHaveBeenCalledTimes(2);
  });
  it('rejects a snapshot without the matching replacement', async () => {
    const {service,tx}=setup();
    await expect(service.update('company-id','actor','user-id',{expectedRoleIds:[]},[],true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('company-id','actor','user-id',{expectedExtraPermissions:[]},[],true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('company-id','actor','user-id',{extraPermissions:null} as any,[],true)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
  it('validates optional expected sets rather than accepting null or non-array values', async () => {
    expect(await validate(plainToInstance(UpdateUserDto,{roleIds:[],expectedRoleIds:[],extraPermissions:[],expectedExtraPermissions:[]}),
      {whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);
    const nullGrants = await validate(plainToInstance(UpdateUserDto,{extraPermissions:null}),{whitelist:true,forbidNonWhitelisted:true});
    expect(nullGrants.map(e=>e.property)).toContain('extraPermissions');
    for (const property of ['expectedRoleIds','expectedExtraPermissions']) {
      for (const value of [null,'bad',[123],['same','same']]) {
        const errors=await validate(plainToInstance(UpdateUserDto,{[property]:value}),{whitelist:true,forbidNonWhitelisted:true});
        expect(errors.map(e=>e.property)).toContain(property);
      }
    }
  });
});
