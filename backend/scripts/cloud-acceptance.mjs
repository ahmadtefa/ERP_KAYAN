#!/usr/bin/env node
// Cloud acceptance test for KAYAN ERP (requirement: open the program, sign in,
// create a company, use the core modules, verify tenant isolation).
//
//   node scripts/cloud-acceptance.mjs [--base http://127.0.0.1:3000]
//
// Runs against ANY live stack (local rehearsal or the real HTTPS deployment)
// over HTTP only - it never touches the database directly and never prints
// secrets. It performs the full first-run journey:
//
//   health -> setup status -> create company + admin -> sign in -> profile
//   -> items -> customers -> quotation -> reports -> token refresh ->
//   security negatives (no token, tampered token, unknown fields) ->
//   tenant scoping assertions (every companyId in responses is the session's).
//
// Exit code 0 = all checks passed. Failures print the server's problem details.
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    base: {
      type: "string",
      default: process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000",
    },
  },
});
const BASE = (args.base ?? "").replace(/\/$/, "");

let passed = 0;
let failed = 0;
const problems = [];

function ok(label, detail) {
  passed += 1;
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) {
  failed += 1;
  problems.push(`${label}: ${detail}`);
  console.log(`  ✕ ${label} — ${detail}`);
}

function check(label, condition, detail) {
  if (condition) ok(label, typeof detail === "string" ? detail : "");
  else fail(label, typeof detail === "string" ? detail : "assertion failed");
}

async function call(
  method,
  path,
  { token, body, expectStatus, label, form } = {},
) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  if (expectStatus && res.status !== expectStatus) {
    fail(
      label ?? `${method} ${path}`,
      `expected ${expectStatus}, got ${res.status}: ${text.slice(0, 300)}`,
    );
    return { status: res.status, data, headers: res.headers };
  }
  return { status: res.status, data, headers: res.headers };
}

const seenCompanyIds = new Set();
function collectCompanyIds(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) collectCompanyIds(v);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "companyId" && typeof v === "string" && v) seenCompanyIds.add(v);
    collectCompanyIds(v);
  }
}

async function main() {
  console.log(`KAYAN ERP cloud acceptance against ${BASE}\n`);

  // ── 1. Health ────────────────────────────────────────────────────────────
  console.log("1. Health");
  const health = await call("GET", "/api/v1/health", { label: "health" });
  check(
    "health endpoint responds",
    health.status === 200,
    `status ${health.status}`,
  );

  // ── 2. First-run setup: create company + admin ───────────────────────────
  console.log("2. First-run setup (create company + admin)");
  const status0 = await call("GET", "/api/v1/setup/status", {
    label: "setup status",
  });
  check(
    "setup status readable",
    status0.status === 200,
    `status ${status0.status}`,
  );
  const needsSetup =
    status0.data?.needsSetup ?? status0.data?.isInitial ?? true;

  const stamp = Date.now().toString(36).toUpperCase().slice(-8);
  const adminUsername = `acc_admin_${stamp.toLowerCase()}`;
  const adminPassword = `Acc3ptance!${stamp}`;
  if (needsSetup) {
    const setup = await call("POST", "/api/v1/setup/initial", {
      expectStatus: 201,
      label: "initial setup",
      body: {
        companyCode: `ACC${stamp}`,
        companyNameEn: "Acceptance Test Company",
        companyNameAr: "شركة اختبار القبول",
        adminUsername,
        adminPassword,
        adminFullNameEn: "Acceptance Admin",
        adminFullNameAr: "مدير اختبار القبول",
      },
    });
    check(
      "company + admin created",
      setup.status === 201,
      `status ${setup.status}`,
    );
  } else if (
    process.env.ACCEPTANCE_USERNAME &&
    process.env.ACCEPTANCE_PASSWORD
  ) {
    // Already initialised (a real deployment): sign in with the provided
    // operator account instead of creating one.
    ok("database already initialised; using ACCEPTANCE_USERNAME to sign in");
  } else {
    fail(
      "initial setup",
      "database already initialised; set ACCEPTANCE_USERNAME/ACCEPTANCE_PASSWORD or run against a fresh database",
    );
  }

  // ── 3. Sign in ───────────────────────────────────────────────────────────
  console.log("3. Sign in");
  const loginUser = process.env.ACCEPTANCE_USERNAME ?? adminUsername;
  const loginPass = process.env.ACCEPTANCE_PASSWORD ?? adminPassword;
  const login = await call("POST", "/api/v1/auth/login", {
    expectStatus: 201,
    label: "login",
    body: { username: loginUser, password: loginPass },
  });
  check("login succeeds", login.status === 201, `status ${login.status}`);
  const access =
    login.data?.accessToken ?? login.data?.access_token ?? login.data?.token;
  const refresh = login.data?.refreshToken ?? login.data?.refresh_token;
  check(
    "access token issued",
    typeof access === "string" && access.length > 20,
  );
  check(
    "refresh token issued",
    typeof refresh === "string" && refresh.length > 20,
  );

  // ── 4. Authenticated profile ─────────────────────────────────────────────
  console.log("4. Profile and company");
  const me = await call("GET", "/api/v1/auth/me", {
    token: access,
    expectStatus: 200,
    label: "me",
  });
  check("profile readable", me.status === 200);
  const sessionCompany = me.data?.companyId ?? me.data?.user?.companyId;
  check(
    "profile carries the session company",
    typeof sessionCompany === "string" && sessionCompany.length > 0,
    sessionCompany ?? "missing",
  );
  collectCompanyIds(me.data);

  // ── 5. Core module: items ────────────────────────────────────────────────
  console.log("5. Inventory items");
  const item = await call("POST", "/api/v1/inventory/items", {
    token: access,
    expectStatus: 201,
    label: "create item",
    body: {
      code: `ACI-${stamp}`,
      nameEn: "Acceptance Item",
      nameAr: "صنف اختبار",
      unit: "pcs",
      salePrice: "10.5",
      purchasePrice: "7",
    },
  });
  check("item created", item.status === 201, `status ${item.status}`);
  const itemId = item.data?.id;
  const items = await call("GET", "/api/v1/inventory/items", {
    token: access,
    expectStatus: 200,
    label: "list items",
  });
  check("items list readable", items.status === 200);
  check(
    "created item is listed",
    !!itemId && JSON.stringify(items.data ?? {}).includes(String(itemId)),
  );
  collectCompanyIds(items.data);
  const itemOne = await call("GET", `/api/v1/inventory/items/${itemId}`, {
    token: access,
    expectStatus: 200,
    label: "get item",
  });
  check("single item readable", itemOne.status === 200);
  collectCompanyIds(itemOne.data);

  // ── 6. Core module: customers ────────────────────────────────────────────
  console.log("6. Customers");
  const customer = await call("POST", "/api/v1/parties/customers", {
    token: access,
    expectStatus: 201,
    label: "create customer",
    body: {
      code: `ACC-${stamp}`,
      nameEn: "Acceptance Customer",
      nameAr: "عميل اختبار",
      phone: "01000000000",
    },
  });
  check(
    "customer created",
    customer.status === 201,
    `status ${customer.status}`,
  );
  const customerId = customer.data?.id;
  const customers = await call("GET", "/api/v1/parties/customers", {
    token: access,
    expectStatus: 200,
    label: "list customers",
  });
  check("customers list readable", customers.status === 200);
  collectCompanyIds(customers.data);

  // ── 7. Core module: sales quotation ──────────────────────────────────────
  console.log("7. Sales quotation");
  const quotation = await call("POST", "/api/v1/sales/quotations", {
    token: access,
    label: "create quotation",
    body: {
      quotationDate: new Date().toISOString().slice(0, 10),
      customerId,
      tables: [
        {
          title: "Main",
          lines: [
            {
              itemId,
              quantity: "2",
              unitPrice: "10.5",
              description: "Acceptance line",
            },
          ],
        },
      ],
    },
  });
  check(
    "quotation created",
    quotation.status === 201,
    `status ${quotation.status} ${JSON.stringify(quotation.data).slice(0, 200)}`,
  );
  collectCompanyIds(quotation.data);
  const quotations = await call("GET", "/api/v1/sales/quotations", {
    token: access,
    expectStatus: 200,
    label: "list quotations",
  });
  check("quotations list readable", quotations.status === 200);
  collectCompanyIds(quotations.data);

  // ── 8. Reports ───────────────────────────────────────────────────────────
  console.log("8. Reports");
  for (const report of [
    "trial-balance",
    "profit-and-loss",
    "customer-balances",
    "balance-sheet",
  ]) {
    const r = await call("GET", `/api/v1/reports/${report}`, {
      token: access,
      label: `report ${report}`,
    });
    check(`report ${report} responds`, r.status === 200, `status ${r.status}`);
    collectCompanyIds(r.data);
  }

  // ── 9. Session rotation ──────────────────────────────────────────────────
  console.log("9. Session rotation");
  const refresh1 = await call("POST", "/api/v1/auth/refresh", {
    label: "refresh",
    body: { refreshToken: refresh },
  });
  check(
    "token refresh succeeds",
    [200, 201].includes(refresh1.status),
    `status ${refresh1.status}`,
  );
  const access2 =
    refresh1.data?.accessToken ??
    refresh1.data?.access_token ??
    refresh1.data?.token;
  const refresh2 = refresh1.data?.refreshToken ?? refresh1.data?.refresh_token;
  check(
    "rotated access token issued",
    typeof access2 === "string" && access2.length > 20,
  );
  const me2 = await call("GET", "/api/v1/auth/me", {
    token: access2,
    expectStatus: 200,
    label: "me after refresh",
  });
  check("rotated token works", me2.status === 200);
  if (typeof refresh2 === "string" && refresh2.length > 20) {
    const reuse = await call("POST", "/api/v1/auth/refresh", {
      label: "refresh reuse (must fail)",
      body: { refreshToken: refresh },
    });
    check(
      "old refresh token is rejected after rotation",
      reuse.status >= 400,
      `status ${reuse.status}`,
    );
  }

  // ── 10. Security negatives ───────────────────────────────────────────────
  console.log("10. Security negatives");
  const noToken = await call("GET", "/api/v1/inventory/items", {
    label: "items without token",
  });
  check(
    "request without token is refused",
    noToken.status === 401,
    `status ${noToken.status}`,
  );
  const badToken = await call("GET", "/api/v1/inventory/items", {
    token: "not.a.real.token",
    label: "items with tampered token",
  });
  check(
    "request with tampered token is refused",
    badToken.status === 401 || badToken.status === 403,
    `status ${badToken.status}`,
  );
  const unknownField = await call("POST", "/api/v1/inventory/items", {
    token: access,
    label: "item with unknown field",
    body: {
      code: `ACX-${stamp}`,
      totallyUnknownField: "x",
      companyId: "11111111-1111-4111-8111-111111111111",
    },
  });
  check(
    "unknown/client-supplied fields are rejected (whitelist)",
    unknownField.status === 400,
    `status ${unknownField.status}`,
  );
  const badLogin = await call("POST", "/api/v1/auth/login", {
    label: "login with wrong password",
    body: { username: adminUsername, password: "wrong-password-x" },
  });
  check(
    "wrong password is refused",
    badLogin.status === 401 || badLogin.status === 400,
    `status ${badLogin.status}`,
  );

  // ── 11. Tenant scoping assertions ────────────────────────────────────────
  console.log("11. Tenant scoping");
  if (sessionCompany) {
    const foreign = [...seenCompanyIds].filter((id) => id !== sessionCompany);
    check(
      "every companyId in responses is the session company",
      foreign.length === 0,
      foreign.length
        ? `foreign ids: ${foreign.join(",")}`
        : `${seenCompanyIds.size} observed id(s)`,
    );
  } else {
    fail("tenant scoping", "no session company to compare against");
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nAcceptance result: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.log("Failures:");
    for (const p of problems) console.log("  - " + p);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("cloud-acceptance: " + (err?.message ?? err));
  process.exit(1);
});
