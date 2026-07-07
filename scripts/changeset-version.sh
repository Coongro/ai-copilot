#!/bin/sh
npx changeset version
node scripts/sync-version.cjs
