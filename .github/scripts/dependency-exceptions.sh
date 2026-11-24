#!/usr/bin/env bash
#
# Validate and query the time-boxed dependency advisory exceptions in
# .github/security/dependency-exceptions.txt.

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
file="${EXCEPTIONS_FILE:-$root_dir/.github/security/dependency-exceptions.txt}"

usage() {
  cat <<'EOF'
Usage: dependency-exceptions.sh <command> [kind]

Commands:
  check          Validate every entry. Fails on malformed, duplicate, expired
                 or incomplete exceptions.
  list [kind]    Print the advisory IDs, one per line. kind is cargo, ghsa or
                 all (default: all).

Set EXCEPTIONS_FILE to validate or query another file.
EOF
}

fail() {
  echo "error: $*" >&2
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

check() {
  local status=0
  local line_no=0
  local today
  local -A seen=()
  today="$(date -u +%F)"

  if [[ ! -f "$file" ]]; then
    fail "exceptions file not found: $file"
    return 1
  fi

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line_no=$((line_no + 1))
    local line
    line="$(trim "${raw%$'\r'}")"

    [[ -z "$line" || "$line" == \#* ]] && continue

    local kind id owner review_by reason
    read -r kind id owner review_by reason <<< "$line"

    if [[ -z "${kind:-}" || -z "${id:-}" || -z "${owner:-}" || -z "${review_by:-}" || -z "${reason:-}" ]]; then
      fail "line $line_no: expected '<cargo|ghsa> <advisory-id> <owner> <review-by> <reason>'"
      status=1
      continue
    fi

    case "$kind" in
      cargo)
        if [[ ! "$id" =~ ^RUSTSEC-[0-9]{4}-[0-9]{4}$ ]]; then
          fail "line $line_no: invalid RustSec advisory ID '$id'"
          status=1
          continue
        fi
        ;;
      ghsa)
        if [[ ! "$id" =~ ^GHSA(-[0-9A-Za-z]{4}){3}$ ]]; then
          fail "line $line_no: invalid GitHub advisory ID '$id'"
          status=1
          continue
        fi
        ;;
      *)
        fail "line $line_no: unknown advisory kind '$kind' (expected cargo or ghsa)"
        status=1
        continue
        ;;
    esac

    if [[ ! "$owner" =~ ^[A-Za-z0-9_.@/-]+$ ]]; then
      fail "line $line_no: owner '$owner' must be a GitHub user or team without spaces"
      status=1
      continue
    fi

    if [[ ! "$review_by" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
      fail "line $line_no: review date '$review_by' must use YYYY-MM-DD"
      status=1
      continue
    fi

    local normalized
    if ! normalized="$(date -u -d "$review_by" +%F 2>/dev/null)" || [[ "$normalized" != "$review_by" ]]; then
      fail "line $line_no: review date '$review_by' is not a valid date"
      status=1
      continue
    fi

    # The exception is valid through the review date and fails the day after.
    if [[ "$review_by" < "$today" ]]; then
      fail "line $line_no: exception for $id expired on $review_by; fix the dependency, move the review date after a new review, or remove the entry"
      status=1
    fi

    local key="${kind}:${id^^}"
    if [[ -n "${seen[$key]:-}" ]]; then
      fail "line $line_no: duplicate exception for $id (first on line ${seen[$key]})"
      status=1
    else
      seen[$key]="$line_no"
    fi
  done < "$file"

  if ((status == 0)); then
    echo "Dependency exceptions are valid."
  fi

  return "$status"
}

list_ids() {
  local kind="${1:-all}"

  case "$kind" in
    all | cargo | ghsa) ;;
    *)
      fail "unknown kind '$kind' (expected cargo, ghsa or all)"
      return 2
      ;;
  esac

  if [[ ! -f "$file" ]]; then
    fail "exceptions file not found: $file"
    return 1
  fi

  while IFS= read -r raw || [[ -n "$raw" ]]; do
    local line
    line="$(trim "${raw%$'\r'}")"

    [[ -z "$line" || "$line" == \#* ]] && continue

    local entry_kind id
    read -r entry_kind id _ <<< "$line"

    if [[ "$kind" != "all" && "$entry_kind" != "$kind" ]]; then
      continue
    fi

    printf '%s\n' "$id"
  done < "$file"
}

command="${1:-check}"

case "$command" in
  check) check ;;
  list) list_ids "${2:-all}" ;;
  help | -h | --help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
