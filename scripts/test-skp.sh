#!/usr/bin/env bash

# ==========================================
# TEST SUITE: ENDPOINT MODUL SKP (PASCA PANEN)
# Target Port: 5002
# ==========================================

BASE_URL="http://localhost:5002/api/v1/skp"

# Masukkan token JWT aktif milik akun Role 1 atau Role 2
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjI1OTcwLCJ1c2VybmFtZSI6ImFkbWluIiwibmFtYSI6IkFkbWluaXN0cmF0b3IiLCJyb2xlSWQiOjEsInJvbGVfaWQiOjEsInJvbGVOYW1lIjoiQWRtaW5pc3RyYXRvciIsImtkVW5pdCI6bnVsbCwiaXNOYXRpb25hbEFjY2VzcyI6dHJ1ZSwiaWF0IjoxNzkwODM5NDIyLCJleHAiOjE3OTA4NjgyMjJ9.KyEfUm4SWOwTfYzH_eMdxdk0Wzr6HqBor9xVuRLLIpQ"

# Token acak/role 3 untuk menguji Role Guard
INVALID_ROLE_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6OTk5LCJyb2xlIjozLCJpYXQiOjE2MDAwMDAwMDB9.dummySignature"

echo "=========================================="
echo "1. UJI OTORISASI & ROLE GUARD"
echo "=========================================="

echo -n "Test 1.1: Request tanpa Token (Ekspektasi: 401 Unauthorized)... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/summary")
if [ "$STATUS" -eq 401 ]; then echo "OK ($STATUS)"; else echo "FAIL ($STATUS)"; fi

echo -n "Test 1.2: Request Role non-1/2 (Ekspektasi: 403 Forbidden)... "
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $INVALID_ROLE_TOKEN" "$BASE_URL/summary")
if [ "$STATUS" -eq 403 ]; then echo "OK ($STATUS)"; else echo "FAIL ($STATUS)"; fi

echo ""
echo "=========================================="
echo "2. UJI ENDPOINT DATA SKP (ROLE 1 & 2)"
echo "=========================================="

echo "Test 2.1: GET /api/v1/skp/summary"
curl -s -X GET "$BASE_URL/summary?year=2026" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq . || curl -s "$BASE_URL/summary?year=2026" -H "Authorization: Bearer $TOKEN"

echo ""
echo "------------------------------------------"
echo "Test 2.2: GET /api/v1/skp/trends"
curl -s -X GET "$BASE_URL/trends?year=2026" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq . || curl -s "$BASE_URL/trends?year=2026" -H "Authorization: Bearer $TOKEN"

echo ""
echo "------------------------------------------"
echo "Test 2.3: GET /api/v1/skp/distribution"
curl -s -X GET "$BASE_URL/distribution?year=2026" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq . || curl -s "$BASE_URL/distribution?year=2026" -H "Authorization: Bearer $TOKEN"

echo ""
echo "------------------------------------------"
echo "Test 2.4: GET /api/v1/skp/list (Pagination & Filter)"
curl -s -X GET "$BASE_URL/list?page=1&limit=5&year=2026&status=aktif" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq . || curl -s "$BASE_URL/list?page=1&limit=5&year=2026&status=aktif"

echo ""
echo "=========================================="
echo "Pengujian Selesai."
echo "=========================================="