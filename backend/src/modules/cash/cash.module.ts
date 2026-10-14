import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CashAccountsService } from './cash-accounts.service';
import { CashController } from './cash.controller';
import { CashTransfersService } from './cash-transfers.service';
import { CashVouchersService } from './cash-vouchers.service';

@Module({
  imports: [PrismaModule, AuditModule, AccountingModule],
  controllers: [CashController],
  providers: [
    CashAccountsService,
    CashVouchersService,
    CashTransfersService,
    BankReconciliationService,
  ],
  exports: [CashAccountsService, CashVouchersService],
})
export class CashModule {}
