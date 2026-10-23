import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnvironment } from './common/config/validate-environment';
import { CompanySettingsModule } from './common/settings/company-settings.module';
import { AuditModule } from './common/audit/audit.module';
import { MaintenanceModule } from './common/maintenance/maintenance.module';
import { WarehouseModule } from './common/warehouse/warehouse.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupModule } from './modules/backup/backup.module';
import { CashModule } from './modules/cash/cash.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { CompanyModule } from './modules/company/company.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ExportModule } from './modules/export/export.module';
import { ImportModule } from './modules/import/import.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { SalesModule } from './modules/sales/sales.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    // Global so the authentication guard can inject JwtService anywhere.
    JwtModule.register({ global: true }),
    PrismaModule,
    // Global: every posting path reads the company's policies from here.
    CompanySettingsModule,
    // Global: every module that moves goods asks which warehouse it moved in.
    WarehouseModule,
    AuditModule,
    MaintenanceModule,
    AuthModule,
    CompanyModule,
    AccountingModule,
    CashModule,
    FixedAssetsModule,
    AdminModule,
    PartiesModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    ReportsModule,
    ReturnsModule,
    DashboardModule,
    SearchModule,
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
    // Authorization is registered here rather than in one feature module: it
    // is a rule about every route, so it must not depend on which modules
    // happen to be imported. (It used to ride in with AccountingModule.)
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
