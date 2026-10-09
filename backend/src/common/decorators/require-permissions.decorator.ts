import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permissions a route requires.
 *
 * Enforcement happens server-side in PermissionsGuard. The client may hide
 * UI for convenience, but that is never the control.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
