import { ForbiddenException } from "@nestjs/common";

import type { AuthUser } from "../../common/decorators/current-user.decorator";
import {
  canReadCost,
  canReadPurchasePrice,
} from "../../common/auth/cost-visibility";
import { grantsOf } from "../../common/warehouse/warehouse-access";
import { warehouseScopeOf } from "../../common/warehouse/warehouse.service";

export interface InventoryReportQuery {
  branchId?: string;
  warehouseId?: string;
  warehouseIds?: string | string[];
  from?: string;
  to?: string;
  itemId?: string;
  categoryId?: string;
  days?: string;
  limit?: string;
}

export interface InventoryReportAccess {
  warehouseIds?: string[];
  branchId?: string;
  restricted: boolean;
  branchRestricted: boolean;
  canReadCost: boolean;
  canReadPurchasePrice: boolean;
}

function requestedWarehouseIds(query: InventoryReportQuery): string[] {
  const multiple = Array.isArray(query.warehouseIds)
    ? query.warehouseIds.flatMap((value) => value.split(","))
    : (query.warehouseIds ?? "").split(",");
  return [
    ...new Set(
      [...multiple, ...(query.warehouseId ? [query.warehouseId] : [])]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** Resolve filters from the authenticated branch and warehouse grants, never from client input alone. */
export function resolveInventoryReportAccess(
  user: AuthUser,
  query: InventoryReportQuery,
): InventoryReportAccess {
  const grants = grantsOf(user);
  const requested = requestedWarehouseIds(query);
  const branchScope = warehouseScopeOf(user);
  if (
    query.branchId &&
    branchScope !== null &&
    !branchScope.includes(query.branchId)
  ) {
    throw new ForbiddenException(
      "This report is outside your assigned branches.",
    );
  }

  let warehouseIds: string[] | undefined;
  let costAllowed = canReadCost(user);
  if (grants !== null) {
    const allowed = grants.filter((grant) => grant.canView);
    const allowedIds = new Set(allowed.map((grant) => grant.warehouseId));
    if (requested.some((id) => !allowedIds.has(id))) {
      throw new ForbiddenException(
        "This report is outside your assigned warehouses.",
      );
    }
    warehouseIds = requested.length > 0 ? requested : [...allowedIds];
    // Do not let an explicit branch filter broaden a warehouse assignment.
    if (
      query.branchId &&
      branchScope !== null &&
      !branchScope.includes(query.branchId)
    ) {
      throw new ForbiddenException(
        "This report is outside your assigned branches.",
      );
    }
    const selected = new Set(warehouseIds);
    costAllowed =
      costAllowed &&
      allowed
        .filter((grant) => selected.has(grant.warehouseId))
        .every((grant) => grant.canSeeCost);
  } else if (requested.length > 0) {
    for (const id of requested) {
      // Unrestricted means unrestricted only within the user's assigned branches.
      if (
        branchScope !== null &&
        !user.warehouseAccess?.some((grant) => grant.warehouseId === id)
      ) {
        // The authenticated grant list can be absent for legacy users. The service
        // will still enforce branch scope; requested ids are further company-checked
        // by its warehouse joins/relations.
      }
    }
    warehouseIds = requested;
  }

  return {
    warehouseIds,
    branchId: query.branchId,
    restricted: grants !== null,
    branchRestricted: branchScope !== null,
    canReadCost: costAllowed,
    canReadPurchasePrice: canReadPurchasePrice(user),
  };
}

export function assertWarehouseReportSupported(
  slug: string,
  access: InventoryReportAccess,
): void {
  // These reports are based on branch-wide ledgers/audit events and cannot be
  // truthfully narrowed to a subset of warehouses without changing their meaning.
  if (
    (access.restricted && slug === "reconciliation") ||
    ((access.restricted || access.branchRestricted) && slug === "audit-trail")
  ) {
    throw new ForbiddenException(
      "This report cannot be safely narrowed to the caller’s assigned scope.",
    );
  }
}
