import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { scopedBranchId } from './warehouse.service';

describe('scopedBranchId', () => {
  it('leaves a company-wide account unfiltered', () => {
    expect(scopedBranchId({ branchId: null, branchIds: [], roles: ['ADMIN'] })).toBeUndefined();
    expect(scopedBranchId({ branchId: null, branchIds: [], roles: ['ADMIN'] }, 'b1')).toBe('b1');
  });

  it('pins a single-branch account to its branch', () => {
    expect(scopedBranchId({ branchId: 'b1', branchIds: ['b1'] })).toBe('b1');
  });

  it('opens a multi-branch account on its home branch instead of failing', () => {
    expect(scopedBranchId({ branchId: 'b2', branchIds: ['b1', 'b2', 'b3'] })).toBe('b2');
  });

  it('still honours an explicit branch inside the assignment', () => {
    expect(scopedBranchId({ branchId: 'b2', branchIds: ['b1', 'b2'] }, 'b1')).toBe('b1');
  });

  it('rejects an explicit branch outside the assignment', () => {
    expect(() => scopedBranchId({ branchId: 'b2', branchIds: ['b1', 'b2'] }, 'b9')).toThrow(ForbiddenException);
  });

  it('asks to choose only when no home branch is among several', () => {
    expect(() => scopedBranchId({ branchId: null, branchIds: ['b1', 'b2'] })).toThrow(BadRequestException);
    expect(() => scopedBranchId({ branchId: 'zz', branchIds: ['b1', 'b2'] })).toThrow(BadRequestException);
  });
});
