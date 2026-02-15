#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# Parallel Escalation Stress Test v2
# Uses xargs for reliable parallel execution
# ──────────────────────────────────────────────────────────────────

API="http://localhost:31172"
PARALLELISM=5
TIMEOUT=120
RESULTS_DIR="/tmp/crawler-parallel-results"
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# ─── URL list file ──────────────────────────────────────────────
URLFILE="/tmp/crawler-test-urls.txt"
cat > "$URLFILE" << 'URLEOF'
https://www.reddit.com/
https://www.reddit.com/r/programming/comments/1i8k3bz/why_is_openai_claiming_o3_is_agi/
https://old.reddit.com/r/technology
https://www.google.com/search?q=artificial+intelligence
https://news.google.com/
https://finance.google.com/finance/quote/AAPL:NASDAQ
https://www.bloomberg.com/
https://www.bloomberg.com/markets
https://www.bloomberg.com/technology
https://www.amazon.com/
https://www.amazon.com/dp/B0D1XD1ZV3
https://www.amazon.com/s?k=laptop
https://www.ebay.com/
https://www.ebay.com/sch/i.html?_nkw=gpu
https://www.zillow.com/
https://www.zillow.com/homes/San-Francisco,-CA_rb/
https://www.linkedin.com/
https://www.linkedin.com/jobs/search/?keywords=engineer
https://twitter.com/
https://x.com/elonmusk
https://www.nytimes.com/
https://www.nytimes.com/section/technology
https://www.wsj.com/
https://www.wsj.com/tech
https://www.washingtonpost.com/
https://www.washingtonpost.com/technology/
https://techcrunch.com/
https://techcrunch.com/category/artificial-intelligence/
https://arstechnica.com/
https://arstechnica.com/gadgets/
https://www.glassdoor.com/Job/jobs.htm
https://www.glassdoor.com/Reviews/index.htm
https://www.indeed.com/
https://www.indeed.com/jobs?q=data+scientist&l=remote
https://www.craigslist.org/
https://sfbay.craigslist.org/search/sof
https://www.nike.com/
https://www.nike.com/w/mens-shoes-nik1zy7ok
https://www.walmart.com/
https://www.walmart.com/browse/electronics
https://www.target.com/
https://www.bestbuy.com/
https://www.bestbuy.com/site/searchpage.jsp?st=laptop
https://www.investing.com/
https://finance.yahoo.com/
https://finance.yahoo.com/quote/AAPL/
https://seekingalpha.com/
https://www.ticketmaster.com/
https://www.airbnb.com/
https://news.ycombinator.com/
https://en.wikipedia.org/wiki/Web_scraping
https://httpbin.org/html
URLEOF

TOTAL=$(wc -l < "$URLFILE" | tr -d ' ')

echo "═══════════════════════════════════════════════════════════════"
echo "  Parallel Escalation Stress Test v2"
echo "  URLs: $TOTAL  |  Parallelism: $PARALLELISM  |  Timeout: ${TIMEOUT}s"
echo "═══════════════════════════════════════════════════════════════"
echo ""

START_ALL=$(date +%s)

# ─── Worker script ──────────────────────────────────────────────
WORKER="/tmp/crawler-test-worker.sh"
cat > "$WORKER" << 'WORKEREOF'
#!/bin/bash
url="$1"
api="$2"
timeout="$3"
results_dir="$4"

# Create a safe filename from URL
idx=$(echo "$url" | md5sum | cut -c1-8)
outfile="$results_dir/result_${idx}.json"

start=$(date +%s)

result=$(curl -s -m "$timeout" -X POST "$api/api/fetch" \
  -H "Content-Type: application/json" \
  --data-raw "{\"url\": \"$url\", \"engine\": \"auto\"}" 2>/dev/null)

end=$(date +%s)
elapsed=$((end - start))

success=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success','?'))" 2>/dev/null || echo "ERR")
status=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('statusCode','?'))" 2>/dev/null || echo "?")
engine=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('engineUsed','?'))" 2>/dev/null || echo "?")
content=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('content','')))" 2>/dev/null || echo "0")
error=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('error',''); print(e[:60] if e else '')" 2>/dev/null || echo "")

# Save structured result
python3 -c "
import json
print(json.dumps({
  'url': '$url',
  'success': '$success',
  'status': '$status',
  'engine': '$engine',
  'content': int('$content' or '0'),
  'time': $elapsed,
  'error': '$error'
}))
" > "$outfile" 2>/dev/null

# Print live
short=$(echo "$url" | sed 's|https://||' | cut -c1-55)
if [ "$success" = "True" ]; then
  printf "  ✅ %-55s %3ss  %-30s %sch\n" "$short" "$elapsed" "$engine" "$content"
else
  printf "  ❌ %-55s %3ss  %-30s %s\n" "$short" "$elapsed" "${engine:-fail}" "$error"
fi
WORKEREOF
chmod +x "$WORKER"

# ─── Run with xargs parallel ───────────────────────────────────
cat "$URLFILE" | xargs -P "$PARALLELISM" -I {} bash "$WORKER" "{}" "$API" "$TIMEOUT" "$RESULTS_DIR"

END_ALL=$(date +%s)
TOTAL_TIME=$((END_ALL - START_ALL))

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SUMMARY ($TOTAL URLs in ${TOTAL_TIME}s, parallelism=$PARALLELISM)"
echo "═══════════════════════════════════════════════════════════════"

# ─── Aggregate with Python ─────────────────────────────────────
python3 - "$RESULTS_DIR" << 'PYEOF'
import json, glob, sys, os

results_dir = sys.argv[1]
results = []
for f in sorted(glob.glob(os.path.join(results_dir, "result_*.json"))):
    with open(f) as fh:
        try:
            results.append(json.load(fh))
        except:
            pass

if not results:
    print("  No results collected!")
    sys.exit(0)

succeeded = sum(1 for r in results if r["success"] == "True")
failed = sum(1 for r in results if r["success"] != "True")

print(f"  Succeeded: {succeeded}/{len(results)}")
print(f"  Failed:    {failed}/{len(results)}")
print()

# By engine
engine_counts = {}
for r in results:
    eng = r.get("engine", "?")
    engine_counts[eng] = engine_counts.get(eng, 0) + 1

print("  By Engine:")
for eng, cnt in sorted(engine_counts.items(), key=lambda x: -x[1]):
    pct = cnt/len(results)*100
    print(f"    {eng:35s}  {cnt:3d} ({pct:.0f}%)")

# Failed
if failed:
    print()
    print("  ❌ Failed URLs:")
    for r in sorted(results, key=lambda x: x["url"]):
        if r["success"] != "True":
            short = r["url"].replace("https://","")[:60]
            print(f"    {short:60s} {r.get('error','')[:50]}")

# Escalated (non-default)
escalated = [r for r in results if r["success"] == "True" and r.get("engine","") not in ("crawlee:http", "?", "")]
if escalated:
    print()
    print("  🔄 Escalated (needed more than fast+proxy):")
    for r in sorted(escalated, key=lambda x: x["url"]):
        short = r["url"].replace("https://","")[:55]
        print(f"    {short:55s} → {r['engine']:25s} {r['content']}ch {r['time']}s")

# Small content (suspicious)
suspicious = [r for r in results if r["success"] == "True" and r.get("content", 0) < 5000]
if suspicious:
    print()
    print("  ⚠️  Suspicious (succeeded but <5K content):")
    for r in sorted(suspicious, key=lambda x: x.get("content",0)):
        short = r["url"].replace("https://","")[:55]
        print(f"    {short:55s} {r['content']}ch via {r.get('engine','?')}")

PYEOF

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  DB Profiles (cached exceptions)"
echo "═══════════════════════════════════════════════════════════════"
cd /Users/xiaoyuchen/workspace/ci/news_workspace/crawler-service
node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/crawler.db');
const rows = db.prepare('SELECT domain, engine, render_js, render_delay_ms, use_proxy, hit_count FROM domain_profiles ORDER BY domain').all();
if (rows.length === 0) {
  console.log('  (none — all sites worked with default fast+proxy)');
} else {
  console.log('  ' + rows.length + ' exception(s):');
  for (const r of rows) {
    const proxy = r.use_proxy ? 'proxy' : 'direct';
    console.log('    ' + r.domain.padEnd(30) + '  engine=' + r.engine.padEnd(10) + '  ' + proxy.padEnd(6) + '  hits=' + r.hit_count + '  delay=' + r.render_delay_ms + 'ms');
  }
}
" 2>/dev/null || echo "  (could not read DB)"
