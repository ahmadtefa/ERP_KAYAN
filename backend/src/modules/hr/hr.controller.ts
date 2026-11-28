import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EosService } from './eos.service';
import { PayrollService, AccountsInput } from './payroll.service';
import { AttendanceRow, EmployeeInput, HrService, SalaryInput, SettingsInput } from './hr.service';

/// Personal data (national id, insurance number, bank account) is masked unless the viewer
/// holds hr.salary.read: the same people who may see pay may see who the person is.
const mayShowPersonal = (user: AuthUser) => user.isSuperAdmin || user.permissions.includes('hr.salary.read') || user.permissions.includes('*');

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService, private readonly payroll: PayrollService, private readonly eos: EosService) {}

  // ---- end-of-service provision ----

  @Get('eos/settings')
  @RequirePermissions('payroll.eos.read')
  eosSettings(@CurrentUser() user: AuthUser) {
    return this.eos.getSettings(user.companyId);
  }

  @Put('eos/settings')
  @RequirePermissions('payroll.eos.manage')
  setEosSettings(@CurrentUser() user: AuthUser, @Body() body: { accrualPercent?: string; expenseAccountId?: string; provisionAccountId?: string }) {
    return this.eos.setSettings(user.companyId, user.userId, body ?? {});
  }

  @Get('eos/accruals')
  @RequirePermissions('payroll.eos.read')
  eosAccruals(@CurrentUser() user: AuthUser) {
    return this.eos.listAccruals(user.companyId);
  }

  @Post('eos/accruals')
  @RequirePermissions('payroll.eos.post')
  accrueEos(@CurrentUser() user: AuthUser, @Body() body: { month?: string }) {
    return this.eos.accrue(user.companyId, user.userId, body?.month ?? '');
  }

  @Post('eos/accruals/:id/reverse')
  @RequirePermissions('payroll.eos.post')
  reverseEosAccrual(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.eos.reverseAccrual(user.companyId, user.userId, id);
  }

  @Get('eos/balances')
  @RequirePermissions('payroll.eos.read')
  eosBalances(@CurrentUser() user: AuthUser) {
    return this.eos.balances(user.companyId);
  }

  @Post('eos/payouts')
  @RequirePermissions('payroll.eos.post')
  settleEos(@CurrentUser() user: AuthUser, @Body() body: { employeeId?: string; amount?: string; payoutDate?: string; fundingAccountId?: string; note?: string }) {
    return this.eos.settle(user.companyId, user.userId, body ?? {});
  }

  @Post('eos/payouts/:id/reverse')
  @RequirePermissions('payroll.eos.post')
  reverseEosPayout(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.eos.reversePayout(user.companyId, user.userId, id);
  }

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

  // ---- payroll runs, accounts and loans ----

  @Get('payroll/accounts')
  @RequirePermissions('payroll.settings.read')
  payrollAccounts(@CurrentUser() user: AuthUser) {
    return this.payroll.getAccounts(user.companyId);
  }

  @Put('payroll/accounts')
  @RequirePermissions('payroll.settings.manage')
  setPayrollAccounts(@CurrentUser() user: AuthUser, @Body() body: AccountsInput) {
    return this.payroll.setAccounts(user.companyId, user.userId, body ?? {});
  }

  @Get('payroll/report')
  @RequirePermissions('payroll.report.read')
  report(@CurrentUser() user: AuthUser, @Query() query: { from?: string; to?: string }) {
    return this.payroll.summaryReport(user.companyId, query.from ?? '', query.to ?? '');
  }

  @Get('payroll/runs')
  @RequirePermissions('payroll.run.read')
  runs(@CurrentUser() user: AuthUser) {
    return this.payroll.listRuns(user.companyId);
  }

  @Get('payroll/runs/:id')
  @RequirePermissions('payroll.run.read')
  run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.getRun(user.companyId, id);
  }

  @Post('payroll/runs')
  @RequirePermissions('payroll.run.create')
  createRun(@CurrentUser() user: AuthUser, @Body() body: { month?: string }) {
    return this.payroll.createRun(user.companyId, user.userId, user.branchId, body?.month ?? '');
  }

  @Post('payroll/runs/:id/recalculate')
  @RequirePermissions('payroll.run.create')
  recalculate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.recalculate(user.companyId, user.userId, id);
  }

  @Post('payroll/runs/:id/approve')
  @RequirePermissions('payroll.run.approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.approve(user.companyId, user.userId, id);
  }

  @Post('payroll/runs/:id/post')
  @RequirePermissions('payroll.run.post')
  postRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.post(user.companyId, user.userId, id);
  }

  @Post('payroll/runs/:id/reverse')
  @RequirePermissions('payroll.run.post')
  reverseRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.reverse(user.companyId, user.userId, id);
  }

  @Post('payroll/runs/:id/pay')
  @RequirePermissions('payroll.run.pay')
  payRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { fundingAccountId?: string }) {
    return this.payroll.pay(user.companyId, user.userId, id, body?.fundingAccountId ?? '');
  }

  @Get('payroll/runs/:id/payslips/:employeeId')
  @RequirePermissions('payroll.payslip.print')
  payslip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payroll.payslip(user.companyId, id, employeeId);
  }

  @Get('loans')
  @RequirePermissions('hr.loan.read')
  loans(@CurrentUser() user: AuthUser, @Query() query: { employeeId?: string }) {
    return this.payroll.listLoans(user.companyId, query.employeeId);
  }

  @Post('loans')
  @RequirePermissions('hr.loan.manage')
  createLoan(@CurrentUser() user: AuthUser, @Body() body: Record<string, never>) {
    return this.payroll.createLoan(user.companyId, user.userId, user.branchId, body ?? {});
  }
}
