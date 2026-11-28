import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AttendanceRow, EmployeeInput, HrService, SalaryInput, SettingsInput } from './hr.service';

/// Personal data (national id, insurance number, bank account) is masked unless the viewer
/// holds hr.salary.read: the same people who may see pay may see who the person is.
const mayShowPersonal = (user: AuthUser) => user.isSuperAdmin || user.permissions.includes('hr.salary.read') || user.permissions.includes('*');

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  @Get('employees')
  @RequirePermissions('hr.employee.read')
  employees(@CurrentUser() user: AuthUser, @Query() query: { status?: string; q?: string }) {
    return this.service.listEmployees(user.companyId, query, mayShowPersonal(user));
  }

  @Get('employees/:id')
  @RequirePermissions('hr.employee.read')
  employee(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getEmployee(user.companyId, id, mayShowPersonal(user));
  }

  @Post('employees')
  @RequirePermissions('hr.employee.manage')
  createEmployee(@CurrentUser() user: AuthUser, @Body() body: EmployeeInput) {
    return this.service.createEmployee(user.companyId, user.userId, body);
  }

  @Patch('employees/:id')
  @RequirePermissions('hr.employee.manage')
  updateEmployee(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: EmployeeInput) {
    return this.service.updateEmployee(user.companyId, user.userId, id, body);
  }

  @Get('employees/:id/salary')
  @RequirePermissions('hr.salary.read')
  salary(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.salaryHistory(user.companyId, id);
  }

  @Post('employees/:id/salary')
  @RequirePermissions('hr.salary.manage')
  setSalary(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: SalaryInput) {
    return this.service.setSalary(user.companyId, user.userId, id, body);
  }

  @Get('attendance/:month')
  @RequirePermissions('hr.attendance.read')
  attendance(@CurrentUser() user: AuthUser, @Param('month') month: string) {
    return this.service.getAttendance(user.companyId, month);
  }

  @Put('attendance/:month')
  @RequirePermissions('hr.attendance.manage')
  saveAttendance(@CurrentUser() user: AuthUser, @Param('month') month: string, @Body() body: { rows?: AttendanceRow[] }) {
    return this.service.saveAttendance(user.companyId, user.userId, month, body?.rows ?? []);
  }

  @Get('settings')
  @RequirePermissions('payroll.settings.read')
  settings(@CurrentUser() user: AuthUser) {
    return this.service.listSettings(user.companyId);
  }

  @Post('settings')
  @RequirePermissions('payroll.settings.manage')
  createSettings(@CurrentUser() user: AuthUser, @Body() body: SettingsInput) {
    return this.service.createSettings(user.companyId, user.userId, body);
  }

  @Post('settings/:id/confirm')
  @RequirePermissions('payroll.settings.manage')
  confirmSettings(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.confirmSettings(user.companyId, user.userId, id);
  }
}
