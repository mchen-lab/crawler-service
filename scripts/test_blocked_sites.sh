#!/usr/bin/env bash
# Test the 3 previously-blocked sites with the enhanced stealth escalation
set -euo pipefail

API="http://localhost:31172"

SITES=(
  "https://www.reddit.com/r/technology"
  "https://www.bloomberg.com"
  "https://www.google.com/search?q=weather"
)

for url in "${SITES[@]}"; do
  echo "==================================================================="
  echo "Testing: $url"
  echo "==================================================================="
  START=$(date +%s)
  
  RESULT=$(curl -s -m 120 -X POST "$API/api/fetch" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"engine\": \"auto\"}")
  
  END=$(date +%s)
  ELAPSED=$((END - START))
  
  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success','?'))" 2>/dev/null || echo "parse_error")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statusCode','?'))" 2>/dev/null || echo "?")
  ENGINE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('engineUsed','?'))" 2>/dev/null || echo "?")
  CONTENT_LEN=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('content','')))" 2>/dev/null || echo "0")
  ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','none'))" 2>/dev/null || echo "unknown")
  
  echo "  Success:    $SUCCESS"
  echo "  Status:     $STATUS"
  echo "  Engine:     $ENGINE"
  echo "  Content:    $CONTENT_LEN chars"
  echo "  Time:       ${ELAPSED}s"
  if [ "$SUCCESS" != "True" ]; then
    echo "  Error:      $ERROR"
  fi
  echo ""
done

echo "=== Server logs (last 30 lines) ==="
tail -30 /tmp/crawler-test.log
