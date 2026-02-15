#!/bin/bash
# =============================================================================
# Auto-Retry Escalation Test Script
# Tests 25 diverse sites with engine: "auto" to evaluate auto-retry logic
# =============================================================================

API="http://localhost:31173/api/fetch"
RESULTS_FILE="/tmp/crawler_auto_test_results.tsv"
LOG_FILE="/tmp/crawler_auto_test.log"

# Header
echo -e "URL\tSUCCESS\tSTATUS\tENGINE_USED\tCONTENT_LEN\tTIME_SEC" > "$RESULTS_FILE"

# 25 diverse sites:
# Group 1: Static / simple HTML (should succeed with fast lane)
# Group 2: JS-rendered SPAs (need browser or stealth)
# Group 3: Anti-bot protected (may need stealth)
# Group 4: News / media sites (mixed behavior)

SITES=(
  # --- Group 1: Static HTML (fast should work) ---
  "https://example.com"
  "https://httpbin.org/html"
  "https://en.wikipedia.org/wiki/Web_crawling"
  "https://news.ycombinator.com"
  "https://lite.cnn.com"
  "https://text.npr.org"

  # --- Group 2: JS-rendered / SPAs (need browser) ---
  "https://www.google.com/search?q=weather"
  "https://www.youtube.com"
  "https://twitter.com/elonmusk"
  "https://www.reddit.com/r/technology"

  # --- Group 3: News / media (mixed, some JS-heavy) ---
  "https://www.bbc.com/news"
  "https://www.nytimes.com"
  "https://www.reuters.com"
  "https://techcrunch.com"
  "https://arstechnica.com"
  "https://www.theverge.com"
  "https://apnews.com"

  # --- Group 4: Anti-bot / harder targets ---
  "https://www.seekingalpha.com"
  "https://www.bloomberg.com"
  "https://www.wsj.com"
  "https://www.linkedin.com"

  # --- Group 5: Misc / Edge Cases ---
  "https://github.com/anthropics/anthropic-sdk-python"
  "https://docs.python.org/3/library/asyncio.html"
  "https://stackoverflow.com/questions/tagged/javascript"
  "https://www.amazon.com"
)

echo "Starting auto-retry escalation test with ${#SITES[@]} sites..."
echo "Results → $RESULTS_FILE"
echo "=========================="
echo ""

i=0
for url in "${SITES[@]}"; do
  i=$((i + 1))
  echo "[$i/${#SITES[@]}] Testing: $url"

  # Time the request (30s timeout)
  START=$(date +%s)
  RESPONSE=$(curl -s --max-time 60 -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"engine\": \"auto\", \"format\": \"html\"}" 2>/dev/null)
  END=$(date +%s)
  ELAPSED=$((END - START))

  if [ -z "$RESPONSE" ]; then
    echo "  ⏱ TIMEOUT (${ELAPSED}s)"
    echo -e "$url\tTIMEOUT\t-\t-\t0\t$ELAPSED" >> "$RESULTS_FILE"
    continue
  fi

  # Parse response
  SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
  STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statusCode',''))" 2>/dev/null)
  ENGINE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('engineUsed',''))" 2>/dev/null)
  CONTENT_LEN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('content','')))" 2>/dev/null)
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)

  if [ "$SUCCESS" = "True" ]; then
    echo "  ✅ ${STATUS} | ${ENGINE} | ${CONTENT_LEN} chars | ${ELAPSED}s"
  else
    echo "  ❌ ${ERROR} | ${ELAPSED}s"
  fi

  echo -e "$url\t$SUCCESS\t$STATUS\t$ENGINE\t$CONTENT_LEN\t$ELAPSED" >> "$RESULTS_FILE"

  # Small delay to be polite
  sleep 1
done

echo ""
echo "=========================="
echo "Test complete! Results in $RESULTS_FILE"
echo ""
echo "=== SUMMARY ==="
echo ""
column -t -s$'\t' "$RESULTS_FILE"
