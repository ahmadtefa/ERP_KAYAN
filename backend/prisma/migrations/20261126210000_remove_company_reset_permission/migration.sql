-- The company reset feature was removed. Take its permission out of the
-- catalogue and out of every role and person that held it, so it no longer
-- shows on the roles screen and cannot be granted for an operation that
-- does not exist.
DELETE FROM "role_permissions"
 WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'admin.reset');
DELETE FROM "user_permissions"
 WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = 'admin.reset');
DELETE FROM "permissions" WHERE "code" = 'admin.reset';
