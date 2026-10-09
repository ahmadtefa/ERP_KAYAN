import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupModule } from './modules/backup/backup.module';
import { ExportModule } from './modules/export/export.module';
import { ImportModule } from './modules/import/import.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SalesModule } from './modules/sales/sales.module';
import { CompanyModule } from './modules/company/company.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global so the authentication guard can inject JwtService anywhere.
    JwtModule.register({ global: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    AccountingModule,
    AdminModule,
    PartiesModule,
    InventoryModule,
    SalesModule,
    CompanyModule,
    PurchasesModule,
    ReportsModule,
    ExportModule,
    ImportModule,
    BackupModule,
    HealthModule,
  ],
  providers: [
    // Order matters. The rate limit runs before authentication, so a flood of
    // password guesses is turned away before any hashing work happens.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Authentication is required everywhere unless a route is marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
