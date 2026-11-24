cd /tmp/kayan/backend
export RATE_LIMIT_ENABLED=false DATABASE_URL='postgresql://kayan:kayan@127.0.0.1:55432/kayan_solar_build?schema=public' KAYAN_BACKUP_DIR=/tmp/kbackups PORT=3999 HOST=127.0.0.1 NODE_ENV=development JWT_ACCESS_SECRET=build-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa JWT_REFRESH_SECRET=build-refresh-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb JWT_ACCESS_TTL=3600 JWT_REFRESH_TTL=604800
mkdir -p /tmp/kbackups
exec node dist/src/main.js
