# TERRA water/biome integration — pre-integration baseline

Date: 2026-11-15 (Asia/Seoul)
Repository: `/data/data/com.termux/files/home/EOS`
Branch: `prototype/unified-water-gate`
Starting commit: `8f3fec72f1882cf42fc8923ebf17a264fa933ace`

## Working tree before integration

The only pre-existing untracked paths were `android-vd-host/evidence/android16-2026-11-15/` and `android-vd-host/evidence/eos-prompt-2026-11-15/`. Both are preserved and untouched. No tracked diff existed.

## Baseline commands and results

- `node --test tests/fluid-gate.test.mjs`: PASS, 25/25. Includes existing isolated prototype scenarios and 100 seeds × 100 deterministic/invariant events.
- `node --test tests/devtools.test.mjs`: PASS, 13/13.
- `npm test`: PASS, 145/145, 0 failed, 0 skipped.

These are pre-integration baseline results; they are not evidence for the new feature.

## Device/ADB status at start

- `adb devices -l`: connected SM-X820 Android 16 at `127.0.0.1:45027`, transport id 4.
- Live display list contained Display 0 only. ECLIPSE Display 16 was absent; no TERRA test activity was listed on Display 0.
- `adb reverse --list` empty; no listener on port 38173.
- Per the requested constraint, do not start, stop, or modify ECLIPSE HostService. Real device QA requiring its virtual display is unavailable unless the user restores it externally.
