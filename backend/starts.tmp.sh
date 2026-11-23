#!/bin/bash
export NODE_ENV=test
export DATABASE_URL='postgresql://kayan:kayan@127.0.0.1:55432/kayan_fresh?schema=public'
export HOST=0.0.0.0 PORT=3013
export JWT_ACCESS_SECRET='kayan-acc-probe-secret-0123456789abcd'
export JWT_REFRESH_SECRET='kayan-acc-probe-refresh-0123456789ab'
exec node dist/src/main.js
