#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
helper="$root/scripts/verify-windows-release-artifacts.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fixture="$tmp/fixture"
mkdir -p "$fixture/zip/nested" "$fixture/evidence/nested" "$tmp/bin"
revision=0123456789abcdef0123456789abcdef01234567
mkdir -p "$tmp/package/signaturee-win-v2.0.0"
printf '{"name":"signaturee","version":"2.0.0"}\n' > "$tmp/package/signaturee-win-v2.0.0/package.json"
printf 'synthetic release\n' > "$tmp/package/signaturee-win-v2.0.0/README.md"
(cd "$tmp/package" && zip -q "$fixture/zip/nested/signaturee-win-v2.0.0.zip" -r signaturee-win-v2.0.0)
hash=$(sha256sum "$fixture/zip/nested/signaturee-win-v2.0.0.zip" | awk '{print toupper($1)}')
printf '%s  signaturee-win-v2.0.0.zip\r\n' "$hash" > "$fixture/evidence/nested/SHA256SUMS.txt"
printf 'revision=%s\r\nzip=signaturee-win-v2.0.0.zip\r\nsha256=%s\r\n' "$revision" "$hash" > "$fixture/evidence/nested/build-metadata.txt"

cat > "$tmp/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1 $2" == 'run download' ]]
name=''; dir=''
while (($#)); do
  case "$1" in
    --name) name=$2; shift 2 ;;
    --dir) dir=$2; shift 2 ;;
    *) shift ;;
  esac
done
case "$name" in
  signaturee-win-*-evidence) cp -R "$MOCK_FIXTURE/evidence/." "$dir/" ;;
  signaturee-win-*) cp -R "$MOCK_FIXTURE/zip/." "$dir/" ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "$tmp/bin/gh"

export PATH="$tmp/bin:$PATH" MOCK_FIXTURE="$fixture" RUN_ID=7 REVISION="$revision" GH_REPO=example/repo
STAGING_DIR="$tmp/staging" "$helper"
test -f "$tmp/staging/signaturee-win-v2.0.0.zip"
test -f "$tmp/staging/SHA256SUMS.txt"
test -f "$tmp/staging/build-metadata.txt"
test "$(find "$tmp/staging" -type f | wc -l)" -eq 3

printf 'revision=wrong\nzip=signaturee-win-v2.0.0.zip\nsha256=%s\n' "$hash" > "$fixture/evidence/nested/build-metadata.txt"
if STAGING_DIR="$tmp/failing-staging" "$helper" >/dev/null 2>&1; then
  echo 'expected metadata mismatch to fail' >&2
  exit 1
fi

echo 'publisher artifact staging regression tests passed'
