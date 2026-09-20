#!/usr/bin/bash
#
# The current primary selection, capped at the producer.
#
# wl-paste asks the selection's owner for the bytes, and the owner decides how
# many there are: a page with everything selected is megabytes. head stops the
# read at max + 1 so an oversized selection is detected by the caller (it sees
# more than max bytes) rather than truncated into a note that looks complete.
# The deadline for an owner that never answers is the supervisor's.
#
# Usage: selection.sh <max-bytes>

set -uo pipefail

max="${1:-}"
[[ "$max" =~ ^[0-9]+$ ]] || exit 64

# Nothing selected is not an error here; wl-paste's own non-zero exit for an
# empty selection would only make the caller distinguish two kinds of nothing.
/usr/bin/wl-paste --primary --no-newline 2>/dev/null | /usr/bin/head -c $((max + 1))
exit 0
