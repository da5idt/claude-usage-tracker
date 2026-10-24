#!/usr/bin/env python3
"""Aggregate Claude Code token usage per local day and model.

Scans every session transcript (*.jsonl) under ~/.claude/projects (or the
directory given as argv[1]), dedupes API responses by message id + request id,
and prints one JSON object:

  {"days": {"YYYY-MM-DD": {"models": {model: [input, output, cacheRead,
   cacheWrite, messages]}, "sessions": N}}, "files": N, "scannedAt": ISO}
"""
import sys

# datetime.fromisoformat needs 3.7, and Python 2 cannot even import what
# follows: check before it, and exit 3 so the mod tries another interpreter.
if sys.version_info < (3, 7):
    sys.stderr.write('aggregate.py needs Python 3.7 or later\n')
    sys.exit(3)

import glob
import json
import os
from datetime import datetime, timezone


def main():
    base = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, 'projects')
    days = {}
    seen = set()
    files = 0
    for path in glob.iglob(os.path.join(root, '**', '*.jsonl'), recursive=True):
        files += 1
        try:
            fh = open(path, 'r', encoding='utf-8', errors='replace')
        except OSError:
            continue
        with fh:
            for line in fh:
                if '"usage"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if entry.get('type') != 'assistant':
                    continue
                message = entry.get('message') or {}
                usage = message.get('usage')
                if not isinstance(usage, dict):
                    continue
                model = message.get('model') or 'unknown'
                if model == '<synthetic>':
                    continue
                # One API response can span several transcript lines (one per
                # content block), and forked sessions copy whole histories.
                key = (message.get('id') or '') + ':' + (entry.get('requestId') or '')
                if key != ':':
                    if key in seen:
                        continue
                    seen.add(key)
                timestamp = entry.get('timestamp') or ''
                try:
                    stamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                except ValueError:
                    continue
                day = stamp.astimezone().strftime('%Y-%m-%d')
                record = days.setdefault(day, {'models': {}, 'sessions': set()})
                row = record['models'].setdefault(model, [0, 0, 0, 0, 0])
                row[0] += int(usage.get('input_tokens') or 0)
                row[1] += int(usage.get('output_tokens') or 0)
                row[2] += int(usage.get('cache_read_input_tokens') or 0)
                row[3] += int(usage.get('cache_creation_input_tokens') or 0)
                row[4] += 1
                session = entry.get('sessionId')
                if session:
                    record['sessions'].add(session)
    out = {
        'days': {
            day: {'models': record['models'], 'sessions': len(record['sessions'])}
            for day, record in days.items()
        },
        'files': files,
        'scannedAt': datetime.now(timezone.utc).isoformat(),
    }
    json.dump(out, sys.stdout)


main()
