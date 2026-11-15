#!/bin/sh
set -eu

if [ "${CANVIX_SKIP_DB_SETUP:-0}" != "1" ]; then
  npm run db:setup
fi

exec node server.js
