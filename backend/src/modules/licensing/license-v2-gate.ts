/**
 * Build-time gate for the per-company licence path (design: docs/licensing/
 * PER-COMPANY-LICENCE-DESIGN.md). This is a source constant, changed only in a
 * reviewed commit. It is deliberately NOT read from the environment, settings,
 * the database or the licence file, so an operator cannot switch it on.
 * It stays false until the enablement evidence in the design (section 6) exists.
 */
export const LICENSE_V2_BUILD = false;
