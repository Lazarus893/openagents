#!/usr/bin/env bash
# Add NEXT_PUBLIC_AUTH_HOSTS to Vercel production env.
# Run from repo root with the Vercel CLI authenticated and linked to the
# frontend project.
set -euo pipefail

VALUE='workspace.openagents.org,frontend-two-flax-61.vercel.app,*.vercel.app,localhost'

echo "Adding NEXT_PUBLIC_AUTH_HOSTS to Vercel (production)"
printf '%s' "${VALUE}" | vercel env add NEXT_PUBLIC_AUTH_HOSTS production

echo "Done. Trigger a redeploy:  vercel --prod"
