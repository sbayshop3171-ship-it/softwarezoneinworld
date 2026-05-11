#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://softwarezoneinworld.store}"

required_endpoints=(
  "/api/runtime-health"
  "/api/voice-assistant"
  "/api/support-team"
  "/api/service-voice-assistant?service_key=phone-service"
  "/api/tools-content"
  "/api/app-download"
  "/api/notifications/latest"
)

optional_endpoints=(
  "/api/social-media-service"
  "/api/reviews"
  "/api/settings"
  "/api/whatsapp-numbers"
)

echo "Checking API endpoints for: ${BASE_URL}"
echo
printf "%-9s %-8s %-4s %s\n" "TYPE" "STATUS" "JSON" "ENDPOINT"
printf "%-9s %-8s %-4s %s\n" "----" "------" "----" "--------"

failed_required=0

is_json_like_body() {
  local file_path="$1"
  local first_char
  first_char="$(LC_ALL=C tr -d '\n\r\t ' < "${file_path}" | head -c 1 || true)"
  [[ "${first_char}" == "{" || "${first_char}" == "[" ]]
}

check_endpoint() {
  local endpoint="$1"
  local endpoint_type="$2"
  local url="${BASE_URL}${endpoint}"
  local tmp_file
  tmp_file="$(mktemp)"

  local curl_meta
  curl_meta="$(curl -sS -L -o "${tmp_file}" -w "%{http_code}|%{content_type}" "${url}" || true)"

  local http_code="${curl_meta%%|*}"
  local content_type="${curl_meta#*|}"
  local is_json="no"

  if [[ "${content_type}" == *"application/json"* ]] || is_json_like_body "${tmp_file}"; then
    is_json="yes"
  fi

  printf "%-9s %-8s %-4s %s\n" "${endpoint_type}" "${http_code}" "${is_json}" "${endpoint}"

  if [[ "${http_code}" == "200" ]]; then
    local body_preview
    body_preview="$(head -c 220 "${tmp_file}" | tr '\n' ' ')"
    echo "          body: ${body_preview}"
  fi

  if [[ "${endpoint_type}" == "required" && ( "${http_code}" != "200" || "${is_json}" != "yes" ) ]]; then
    failed_required=$((failed_required + 1))
  fi

  rm -f "${tmp_file}"
}

for endpoint in "${required_endpoints[@]}"; do
  check_endpoint "${endpoint}" "required"
done

for endpoint in "${optional_endpoints[@]}"; do
  check_endpoint "${endpoint}" "optional"
done

echo
if [[ "${failed_required}" -gt 0 ]]; then
  echo "Result: FAIL (${failed_required} required endpoint(s) are not valid JSON API 200)."
  echo "Hint: backend is running old code, wrong startup file, stale node process, or proxy/routing is sending HTML."
  exit 1
fi

echo "Result: PASS (all required endpoints returned JSON 200)."
