#!/bin/sh
# Health check script for the Next.js app container
wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
