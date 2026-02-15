#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# Escalation Survey: test a wide range of difficult sites
# to see which escalation level each site ends up needing.
# ──────────────────────────────────────────────────────────────────
set +e

API="http://localhost:31172"

SITES=(
  # ── Cloudflare-protected ────────────────────────────────────────
  "https://www.linkedin.com/feed/"
  "https://www.zillow.com/"
  "https://www.glassdoor.com/Job/jobs.htm"
  "https://www.indeed.com/jobs?q=engineer"
  "https://www.craigslist.org/"
  
  # ── Heavy anti-bot (Akamai, PerimeterX, DataDome) ──────────────
  "https://www.nike.com/"
  "https://www.ticketmaster.com/"
  "https://www.walmart.com/"
  
  # ── Rate-limited / fingerprinting ──────────────────────────────
  "https://www.amazon.com/"
  "https://www.ebay.com/"
  "https://twitter.com/"
  "https://www.instagram.com/"
  
  # ── JS-heavy SPA / paywall ─────────────────────────────────────
  "https://www.nytimes.com/"
  "https://www.wsj.com/"
  "https://www.washingtonpost.com/"
  "https://techcrunch.com/"
  
  # ── Previously blocked (should now use cached fast+direct) ─────
  "https://www.reddit.com/r/technology"
  "https://www.bloomberg.com"
  "https://www.google.com/search?q=weather"
  
  # ── Regular / control group ────────────────────────────────────
  "https://news.ycombinator.com/"
  "https://en.wikipedia.org/wiki/Web_scraping"
  "https://httpbin.org/html"
)

printf "\n%-50s %-8s %-35s %-10s %-6s\n" "SITE" "STATUS" "ENGINE" "CONTENT" "TIME"
printf "%-50s %-8s %-35s %-10s %-6s\n" "$(printf '%0.s─' {1..50})" "$(printf '%0.s─' {1..8})" "$(printf '%0.s─' {1..35})" "$(printf '%0.s─' {1..10})" "$(printf '%0.s─' {1..6})"

for url in "${SITES[@]}"; do
  START=$(date +%s)
  
  RESULT=$(curl -s -m 120 -X POST "$API/api/fetch" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"engine\": \"auto\"}")
  
  END=$(date +%s)
  ELAPSED=$((END - START))

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success','?'))" 2>/dev/null || echo "ERR")
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statusCode','?'))" 2>/dev/null || echo "?")
  ENGINE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('engineUsed','?'))" 2>/dev/null || echo "?")
  CONTENT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('content','')))" 2>/dev/null || echo "0")
  ERROR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',''); print(e[:40] if e else '')" 2>/dev/null || echo "")

  # Truncate URL for display
  SHORT_URL=$(echo "$url" | sed 's|https://||' | cut -c1-48)
  
  if [ "$SUCCESS" = "True" ]; then
    printf "✅ %-48s %-8s %-35s %-10s %ss\n" "$SHORT_URL" "$STATUS" "$ENGINE" "${CONTENT}ch" "$ELAPSED"
  else
    printf "❌ %-48s %-8s %-35s %-10s %ss  %s\n" "$SHORT_URL" "$STATUS" "$ENGINE" "${CONTENT}ch" "$ELAPSED" "$ERROR"
  fi
done

echo ""
echo "=== Domain profiles in DB (exceptions only) ==="
# Query the crawler API to list cached profiles
curl -s "$API/api/profiles" 2>/dev/null | python3 -c "
import sys,json
try:
  data = json.load(sys.stdin)
  profiles = data if isinstance(data, list) else data.get('profiles', data.get('data', []))
  if not profiles:
    print('  (none cached — all sites worked with default fast+proxy)')
  else:
    print(f'  {len(profiles)} exception(s):')
    for p in profiles:
      print(f'    {p[\"domain\"]:30s}  engine={p[\"engine\"]:8s}  proxy={p.get(\"use_proxy\",\"?\")}  hits={p.get(\"hit_count\",0)}  delay={p.get(\"render_delay_ms\",0)}ms')
except Exception as e:
  print(f'  Could not parse profiles: {e}')
" 2>/dev/null || echo "  (profiles endpoint not available)"
