#!/usr/bin/env bash
# Set production env vars on the Railway backend service.
# Run from repo root with the Railway CLI authenticated and linked to the
# `backend` service of project `openagents-backend`.
set -euo pipefail

CORS_VALUE='https://workspace.openagents.org,https://frontend-two-flax-61.vercel.app,http://localhost:3000'

echo "Setting CORS_ORIGINS on Railway → backend service"
railway variables --set "CORS_ORIGINS=${CORS_VALUE}"

echo "Done. Trigger a redeploy if Railway didn't auto-redeploy."
