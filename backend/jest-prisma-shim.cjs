/*
 * Test-only Prisma client shim.
 *
 * Why this exists
 * ---------------
 * In a fully provisioned environment `prisma generate` emits a real client into
 * node_modules/.prisma/client and this shim is never used (jest.config.cjs only
 * maps "@prisma/client" here when that generated client is missing).
 *
 * Some sandboxes/offline CI caches cannot reach binaries.prisma.sh to download
 * the schema engine that `prisma generate` needs, so the generated client stays
 * as the placeholder stub whose `Prisma.Decimal` is undefined. The unit test
 * suite never opens a database: every service is handed a hand-rolled mock of
 * PrismaService. It only needs the *runtime* value exports (Decimal, sql, the
 * enums, the known-request-error class). Decimal and friends are re-exported
 * from Prisma's own engine-less runtime package, so the arithmetic is the real
 * production implementation rather than a reimplementation.
 *
 * No production/build code imports this file. It is wired only through
 * jest.config.cjs and only while the generated client is absent.
 */
'use strict';

const runtime = require('@prisma/client/runtime/library');

// Prisma enums are plain string-valued objects at runtime. Keep the members in
// sync with prisma/schema.prisma.
function makeEnum(members) {
  return Object.freeze(
    members.reduce((acc, member) => {
      acc[member] = member;
      return acc;
    }, {}),
  );
}

const AccountType = makeEnum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
const BranchKind = makeEnum(['HEADQUARTERS', 'BRANCH']);
const CashAccountKind = makeEnum(['CASH', 'BANK']);
const CashVoucherKind = makeEnum(['RECEIPT', 'PAYMENT']);
const CostCenterType = makeEnum([
  'DEPARTMENT',
  'ADMINISTRATIVE_UNIT',
  'PROJECT',
]);
const InvoiceDocumentType = makeEnum([
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
]);
const InvoiceStatus = makeEnum(['DRAFT', 'POSTED', 'REVERSED']);
const JournalStatus = makeEnum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'REVERSED',
  'CANCELLED',
]);
const OrderStatus = makeEnum([
  'DRAFT',
  'APPROVED',
  'PARTIALLY_FULFILLED',
  'CANCELLED',
  'FULFILLED',
]);
const PeriodStatus = makeEnum(['OPEN', 'CLOSED']);
const StockDirection = makeEnum(['IN', 'OUT']);
const StockDocumentKind = makeEnum(['ADJUSTMENT', 'TRANSFER', 'COUNT', 'OPENING']);
const QuotationStatus = makeEnum([
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CONVERTED',
]);
const QuotationEventType = makeEnum([
  'CREATED',
  'UPDATED',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'REVISED',
  'CONVERTED',
  'FOLLOW_UP',
  'NOTE',
]);

// Minimal tagged-template stand-in for Prisma.sql. The unit tests mock
// $queryRaw/$executeRaw, but they assert on the same shape a real Prisma.Sql
// value exposes: `sql` is the statement text with `?` placeholders and `values`
// is the ordered list of bound parameters. Nested fragments (Prisma.sql /
// Prisma.join) are inlined so composable queries keep working.
function isFragment(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.sql === 'string' &&
    Array.isArray(value.values)
  );
}

function sql(strings, ...values) {
  const flatValues = [];
  let text = String(strings[0]);
  values.forEach((value, index) => {
    if (isFragment(value)) {
      text += value.sql;
      flatValues.push(...value.values);
    } else {
      text += '?';
      flatValues.push(value);
    }
    text += String(strings[index + 1]);
  });
  return { sql: text, values: flatValues };
}

// A distinct sentinel, mirroring Prisma.DbNull's role as a JSON null marker.
const DbNull = Symbol.for('prisma.dbNull');

const Prisma = {
  Decimal: runtime.Decimal,
  sql,
  join: runtime.join,
  empty: runtime.empty,
  DbNull,
  PrismaClientKnownRequestError: runtime.PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError: runtime.PrismaClientUnknownRequestError,
  PrismaClientInitializationError: runtime.PrismaClientInitializationError,
  PrismaClientRustPanicError: runtime.PrismaClientRustPanicError,
  PrismaClientValidationError: runtime.PrismaClientValidationError,
};

// Services extend PrismaClient; tests construct them with mocked collaborators
// and never instantiate this against a real database. A no-op base is enough.
class PrismaClient {
  constructor(_options) {
    // no-op
  }
}

module.exports = {
  Prisma,
  PrismaClient,
  AccountType,
  BranchKind,
  CashAccountKind,
  CashVoucherKind,
  CostCenterType,
  InvoiceDocumentType,
  InvoiceStatus,
  JournalStatus,
  OrderStatus,
  PeriodStatus,
  StockDirection,
  StockDocumentKind,
  QuotationStatus,
  QuotationEventType,
};
