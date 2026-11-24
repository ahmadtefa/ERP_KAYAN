import type { Transaction, SqlDriverAdapter } from '@prisma/driver-adapter-utils';
import { guardAdapterTransactions, guardTransactionLifetime } from './transaction-lifetime';

const query = (sql: string) => ({ sql, args: [], argTypes: [] });
function fixture() {
  const raw = { provider: 'postgres', adapterName: 'test', options: {usePhantomQuery:false},
    queryRaw: jest.fn().mockResolvedValue({rows:[]}), executeRaw: jest.fn().mockResolvedValue(0),
    commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined),
  };
  return {raw, guarded:guardTransactionLifetime(raw as Transaction)};
}
describe('transaction lifetime boundary',()=>{
  it.each(['ROLLBACK','COMMIT',' rollback; '])('refuses nested continuation after %s is queued',async(sql)=>{
    const {raw,guarded}=fixture();let release!:()=>void;
    raw.executeRaw.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve(0);}));
    const close=guarded.executeRaw(query(sql));
    await expect(guarded.queryRaw(query('INSERT child'))).rejects.toThrow('transaction is closed');
    await expect(guarded.executeRaw(query('INSERT audit'))).rejects.toThrow('transaction is closed');
    expect(raw.queryRaw).not.toHaveBeenCalled();expect(raw.executeRaw).toHaveBeenCalledTimes(1);
    release();await close;await guarded.rollback();expect(raw.rollback).toHaveBeenCalledTimes(1);
  });
  it('an already issued parent settles but cannot start children after timeout rollback',async()=>{
    const {raw,guarded}=fixture();let finish!:()=>void;
    raw.queryRaw.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({rows:[['parent']]});}));
    const parent=guarded.queryRaw(query('INSERT parent'));
    const rollback=guarded.executeRaw(query('ROLLBACK'));
    finish();await parent;await rollback;
    await expect(guarded.queryRaw(query('INSERT child'))).rejects.toThrow();
    expect(raw.queryRaw).toHaveBeenCalledTimes(1);
  });
  it('allows normal operations then closes on phantom rollback/commit',async()=>{
    for(const method of ['commit','rollback'] as const){const {raw,guarded}=fixture();await guarded.queryRaw(query('SELECT'));await guarded.executeRaw(query('INSERT'));await guarded[method]();await expect(guarded.queryRaw(query('SELECT'))).rejects.toThrow();expect(raw[method]).toHaveBeenCalledTimes(1);}
  });
  it('wraps every new adapter transaction, binding ordinary methods correctly',async()=>{
    const {raw}=fixture();const adapter={startTransaction:jest.fn().mockResolvedValue(raw),provider:'postgres',adapterName:'test',getConnectionInfo(){return {schemaName:this.adapterName};}};
    const guarded=guardAdapterTransactions(adapter as unknown as SqlDriverAdapter);
    expect(guarded.getConnectionInfo!().schemaName).toBe('test');
    const tx=await guarded.startTransaction();await tx.executeRaw(query('ROLLBACK'));await expect(tx.queryRaw(query('INSERT child'))).rejects.toThrow();
    const other=await guarded.startTransaction();await other.queryRaw(query('SELECT'));expect(raw.queryRaw).toHaveBeenCalledTimes(1);
  });
});
