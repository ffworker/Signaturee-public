#!/usr/bin/env bash
set -euo pipefail

: "${RUN_ID:?RUN_ID is required}"
: "${REVISION:?REVISION is required}"
: "${GH_REPO:?GH_REPO is required}"
: "${STAGING_DIR:?STAGING_DIR is required}"

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$work_dir/zip" "$work_dir/evidence"

# Download each artifact into its own temporary directory, then flatten only
# the expected files into one staging directory. gh may add artifact folders.
gh run download "$RUN_ID" --repo "$GH_REPO" \
  --name "signaturee-win-$REVISION" --dir "$work_dir/zip"
gh run download "$RUN_ID" --repo "$GH_REPO" \
  --name "signaturee-win-$REVISION-evidence" --dir "$work_dir/evidence"

mapfile -t zips < <(find "$work_dir/zip" -type f -name '*.zip' -print)
mapfile -t sums < <(find "$work_dir/evidence" -type f -name 'SHA256SUMS.txt' -print)
mapfile -t metadata < <(find "$work_dir/evidence" -type f -name 'build-metadata.txt' -print)
[[ ${#zips[@]} -eq 1 && ${#sums[@]} -eq 1 && ${#metadata[@]} -eq 1 ]] || {
  echo 'Expected exactly one ZIP, checksum manifest, and metadata file' >&2
  exit 1
}

zip_path=${zips[0]}
sum_path=${sums[0]}
metadata_path=${metadata[0]}

# Windows PowerShell writes CRLF; normalize text evidence before Unix checks.
tr -d '\r' < "$sum_path" > "$work_dir/SHA256SUMS.txt"
tr -d '\r' < "$metadata_path" > "$work_dir/build-metadata.txt"
sum_path="$work_dir/SHA256SUMS.txt"
metadata_path="$work_dir/build-metadata.txt"

# Do not trust an artifact merely because it has the right artifact name.
grep -Fxq "revision=$REVISION" "$metadata_path" || {
  echo 'Artifact metadata revision does not match requested revision' >&2
  exit 1
}
zip_name=$(basename "$zip_path")
expected_version=$(unzip -p "$zip_path" '*/package.json' | jq -r '.version // empty' | head -n 1)
[[ "$expected_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo 'ZIP package.json has no exact stable semver version' >&2
  exit 1
}
expected_zip="signaturee-win-v$expected_version.zip"
[[ "$zip_name" == "$expected_zip" ]] || {
  echo "ZIP name $zip_name does not match package version $expected_version" >&2
  exit 1
}
awk -v name="$zip_name" '$2 == name { found=1 } END { exit !found }' "$sum_path" || {
  echo 'Checksum manifest does not name the expected ZIP' >&2
  exit 1
}
( cd "$(dirname "$zip_path")" && sha256sum -c "$sum_path" --ignore-missing )
actual_hash=$(sha256sum "$zip_path" | awk '{print toupper($1)}')
grep -Fxq "zip=$zip_name" "$metadata_path" || {
  echo 'Metadata ZIP name does not match the artifact' >&2
  exit 1
}
grep -Fxq "sha256=$actual_hash" "$metadata_path" || {
  echo 'Metadata SHA-256 does not match the artifact' >&2
  exit 1
}

cp -- "$zip_path" "$sum_path" "$metadata_path" "$STAGING_DIR/"
printf 'Verified exact release artifact: %s\n' "$STAGING_DIR/$zip_name"
