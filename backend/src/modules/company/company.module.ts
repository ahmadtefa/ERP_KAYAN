import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({ imports: [PrismaModule, AuditModule], controllers: [CompanyController], providers: [CompanyService] })
export class CompanyModule {}
