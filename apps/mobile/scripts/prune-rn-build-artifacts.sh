#!/usr/bin/env bash
set -euo pipefail

mode="dry-run"
case "${1:-}" in
  "") ;;
  --apply-if-low-space) mode="apply-if-low-space" ;;
  --force) mode="force" ;;
  *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
esac

script_mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mobile_root="${VIMICATE_RN_MOBILE_ROOT:-$script_mobile_root}"
derived_root="${VIMICATE_XCODE_DERIVED_ROOT:-${HOME}/Library/Developer/Xcode/DerivedData}"
archives_root="${VIMICATE_XCODE_ARCHIVES_ROOT:-${HOME}/Library/Developer/Xcode/Archives}"
temporary_derived_root="${VIMICATE_RN_TEMP_DERIVED_ROOT:-/private/tmp}"
minimum_free_gib="${VIMICATE_RN_MINIMUM_FREE_GIB:-50}"
keep_archives="${VIMICATE_RN_KEEP_ARCHIVES:-3}"

[[ "$minimum_free_gib" =~ ^[0-9]+$ ]] || { echo "ERROR: invalid minimum free GiB" >&2; exit 2; }
[[ "$keep_archives" =~ ^[0-9]+$ ]] || { echo "ERROR: invalid archive keep count" >&2; exit 2; }
[[ -d "$mobile_root" && -f "$mobile_root/package.json" ]] || { echo "ERROR: RN mobile root is invalid" >&2; exit 2; }

free_kib="$(df -Pk "$mobile_root" | awk 'NR == 2 {print $4}')"
threshold_kib=$((minimum_free_gib * 1024 * 1024))
if [[ "$mode" == "apply-if-low-space" && "$free_kib" -ge "$threshold_kib" ]]; then
  printf 'RN_BUILD_PRUNE_STATUS=SKIPPED free_gib=%.1f threshold_gib=%s reason=space_sufficient\n' "$(awk -v kb="$free_kib" 'BEGIN {print kb/1048576}')" "$minimum_free_gib"
  exit 0
fi

apply=0
[[ "$mode" == "apply-if-low-space" || "$mode" == "force" ]] && apply=1
candidate_kib=0
removed_count=0
skipped_open_count=0

size_kib() { du -sk "$1" 2>/dev/null | awk '{print $1+0}'; }
has_open_files() {
  command -v lsof >/dev/null 2>&1 || return 1
  lsof +D "$1" 2>/dev/null | awk 'NR > 1 {found=1; exit} END {exit !found}'
}
remove_generated() {
  local generated_path="$1" category="$2" size
  [[ -e "$generated_path" ]] || return 0
  case "$generated_path" in
    "$mobile_root/.xcodebuildmcp-command-cancel"|\
    "$mobile_root/.xcodebuildmcp-command-responder"|\
    "$mobile_root/.xcodebuildmcp-scene-boundary-release"|\
    "$mobile_root/dist"|\
    "$mobile_root/build/xcodebuildmcp-bug150-late-callback-release"|\
    "$mobile_root/build/xcodebuildmcp-bug150-scene-release"|\
    "$mobile_root/build/xcodebuildmcp-bug256-chronology-release"|\
    "$mobile_root/build/xcodebuildmcp-bug257-history-writer-release"|\
    "$mobile_root/build/xcodebuildmcp-bug258-approval-writer-release"|\
    "$mobile_root/build/xcodebuildmcp-bug259-publication-equality-release"|\
    "$mobile_root/build/xcodebuildmcp-bug260-prompt-commit-release"|\
    "$mobile_root/build/xcodebuildmcp-simulator-release"|\
    "$mobile_root/build/xcodebuildmcp-fold-toggle"|\
    "$mobile_root/build/xcodebuildmcp-table-fixture"|\
    "$mobile_root/.xcodebuildmcp-physical-runner/DerivedData"|\
    "$mobile_root/.xcodebuildmcp-physical-runner/DerivedDataPhysical"|\
    "$mobile_root/.xcodebuildmcp-physical-runner/DerivedDataSimulator"|\
    "$mobile_root/.xcodebuildmcp-physical-runner/DeviceDerivedData"|\
    "$derived_root"/VimicateRN-*) ;;
    "$mobile_root"/.xcodebuildmcp-*)
      [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || {
        echo "ERROR: refused top-level RN build path without Xcode DerivedData markers: $generated_path" >&2
        exit 3
      }
      ;;
    "$mobile_root"/build/xcodebuildmcp-*)
      [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || {
        echo "ERROR: refused RN build path without Xcode DerivedData markers: $generated_path" >&2
        exit 3
      }
      ;;
    "$temporary_derived_root"/vimicate-*|"$temporary_derived_root"/VimicateRN-*)
      [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || {
        echo "ERROR: refused temporary path without Xcode DerivedData markers: $generated_path" >&2
        exit 3
      }
      ;;
    *) echo "ERROR: refused non-allowlisted path: $generated_path" >&2; exit 3 ;;
  esac
  if has_open_files "$generated_path"; then
    echo "SKIP_OPEN category=$category path=$generated_path"
    skipped_open_count=$((skipped_open_count + 1))
    return 0
  fi
  size="$(size_kib "$generated_path")"
  if [[ "$apply" == "1" ]]; then rm -rf -- "$generated_path"; fi
  echo "$([[ "$apply" == "1" ]] && echo REMOVED || echo WOULD_REMOVE) category=$category size_kib=$size path=$generated_path"
  candidate_kib=$((candidate_kib + size))
  removed_count=$((removed_count + 1))
}

remove_generated "$mobile_root/.xcodebuildmcp-command-cancel" rn-derived
remove_generated "$mobile_root/.xcodebuildmcp-command-responder" rn-derived
remove_generated "$mobile_root/.xcodebuildmcp-scene-boundary-release" rn-derived
remove_generated "$mobile_root/dist" rn-eas-export
remove_generated "$mobile_root/build/xcodebuildmcp-bug150-late-callback-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug150-scene-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug256-chronology-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug257-history-writer-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug258-approval-writer-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug259-publication-equality-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-bug260-prompt-commit-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-simulator-release" rn-derived
remove_generated "$mobile_root/build/xcodebuildmcp-fold-toggle" rn-fixture-derived
remove_generated "$mobile_root/build/xcodebuildmcp-table-fixture" rn-fixture-derived
remove_generated "$mobile_root/.xcodebuildmcp-physical-runner/DerivedData" rn-runner-derived
remove_generated "$mobile_root/.xcodebuildmcp-physical-runner/DerivedDataPhysical" rn-runner-derived
remove_generated "$mobile_root/.xcodebuildmcp-physical-runner/DerivedDataSimulator" rn-runner-derived
remove_generated "$mobile_root/.xcodebuildmcp-physical-runner/DeviceDerivedData" rn-runner-derived

# Ad-hoc direct XcodeBuildMCP Release checks can also use a hidden top-level
# `.xcodebuildmcp-*` DerivedData root. Admit only exact top-level children with
# both canonical markers. The runner workspace, its source and nested caches do
# not satisfy this shape. The three legacy exact paths above stay outside this
# loop to avoid counting them twice in dry-run mode.
while IFS= read -r -d '' generated_path; do
  case "$(basename "$generated_path")" in
    .xcodebuildmcp-command-cancel|.xcodebuildmcp-command-responder|.xcodebuildmcp-scene-boundary-release) continue ;;
  esac
  [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || continue
  remove_generated "$generated_path" rn-top-level-xcode-derived
done < <(find "$mobile_root" -mindepth 1 -maxdepth 1 -type d -name '.xcodebuildmcp-*' -print0)

# Ad-hoc RN Release checks use bug-specific build/xcodebuildmcp-* roots. Keep
# the allowlist structural: the path must be one top-level matching directory
# and carry both canonical Xcode DerivedData markers.
if [[ -d "$mobile_root/build" ]]; then
  while IFS= read -r -d '' generated_path; do
    [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || continue
    remove_generated "$generated_path" rn-build-xcode-derived
  done < <(find "$mobile_root/build" -mindepth 1 -maxdepth 1 -type d -name 'xcodebuildmcp-*' -print0)
fi

if [[ -d "$derived_root" ]]; then
  while IFS= read -r -d '' path; do remove_generated "$path" xcode-rn-derived; done \
    < <(find "$derived_root" -mindepth 1 -maxdepth 1 -type d -name 'VimicateRN-*' -print0)
fi

# XcodeBuildMCP jobs use unique /private/tmp DerivedData roots so parallel and
# interrupted Release checks cannot collide. Admit only directories that are
# top-level Vimicate names and contain both canonical Xcode DerivedData
# markers. Retained crash bundles, screenshots, videos, OTA exports and small
# current acceptance-runner caches do not satisfy this shape.
if [[ -d "$temporary_derived_root" ]]; then
  while IFS= read -r -d '' generated_path; do
    case "$(basename "$generated_path")" in
      vimicate-rn-physical-acceptance|vimicate-acceptance-trusted-cert) continue ;;
    esac
    [[ -f "$generated_path/info.plist" && -d "$generated_path/Build/Products" ]] || continue
    remove_generated "$generated_path" rn-temporary-xcode-derived
  done < <(find "$temporary_derived_root" -mindepth 1 -maxdepth 1 -type d \( -name 'vimicate-*' -o -name 'VimicateRN-*' \) -print0)
fi

# Keep the newest signed archives for local evidence/re-export. Only older
# VimicateRN archives are eligible; native Vimicate and every other app are
# outside this allowlist.
if [[ -d "$archives_root" ]]; then
  archive_index=0
  while IFS= read -r archive; do
    archive_index=$((archive_index + 1))
    [[ "$archive_index" -le "$keep_archives" ]] && continue
    [[ "$archive" == "$archives_root/"* && "$(basename "$archive")" == VimicateRN\ *.xcarchive ]] || { echo "ERROR: refused archive path: $archive" >&2; exit 3; }
    if has_open_files "$archive"; then
      echo "SKIP_OPEN category=old-rn-archive path=$archive"
      skipped_open_count=$((skipped_open_count + 1))
      continue
    fi
    size="$(size_kib "$archive")"
    if [[ "$apply" == "1" ]]; then rm -rf -- "$archive"; fi
    echo "$([[ "$apply" == "1" ]] && echo REMOVED || echo WOULD_REMOVE) category=old-rn-archive size_kib=$size path=$archive"
    candidate_kib=$((candidate_kib + size))
    removed_count=$((removed_count + 1))
  done < <(find "$archives_root" -mindepth 2 -maxdepth 2 -type d -name 'VimicateRN *.xcarchive' -print0 \
    | xargs -0 stat -f '%m %N' 2>/dev/null | sort -rn | cut -d' ' -f2-)
fi

free_after_kib="$(df -Pk "$mobile_root" | awk 'NR == 2 {print $4}')"
actual_reclaimed_kib=$((free_after_kib - free_kib))
[[ "$actual_reclaimed_kib" -lt 0 ]] && actual_reclaimed_kib=0
printf 'RN_BUILD_PRUNE_STATUS=%s candidates=%s skipped_open=%s candidate_gib=%.2f reclaimed_gib=%.2f free_gib=%.1f\n' \
  "$([[ "$apply" == "1" ]] && echo APPLIED || echo DRY_RUN)" "$removed_count" "$skipped_open_count" \
  "$(awk -v kb="$candidate_kib" 'BEGIN {print kb/1048576}')" \
  "$(awk -v kb="$actual_reclaimed_kib" 'BEGIN {print kb/1048576}')" \
  "$(awk -v kb="$free_after_kib" 'BEGIN {print kb/1048576}')"

# Deliberately protected: source/Git state, node_modules, Pods, build/fastlane,
# build/profiles, ios/build codegen inputs, physical-runner source,
# Keychain/provisioning data, installed
# apps, CoreSimulator devices, generic/shared DerivedData, native Vimicate
# archives, crash reports/videos/OTA exports, and all OpenClaw/Codex/Vimicate
# session history.
