import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import type { Finding } from '../core/ir.js';
import { repoRelative } from '../core/paths.js';
import { finding } from '../core/report.js';
import { DISCOVERY_RULES } from '../core/rules.js';

/**
 * Live composition probe. Contract: docs/spec.md §8.
 *
 * `--verify-live` asks the installed DSH binary to compose the generated patch
 * on top of the shipped `web` profile in a throwaway `DSH_HOME`. A nonzero exit
 * means DSH would reject the bundle (unknown package, invalid child config,
 * duplicate preset id); a missing preset row means the bundle loaded but the
 * generated preset is not in the roster. Both are failures: an install that
 * cannot compose is worse than a byte-level drift.
 *
 * The probe never reads or writes the user's profile, never installs packages,
 * and makes no network request. It fails closed when `dsh` is unavailable.
 */

const execFileAsync = promisify(execFile);

const PROFILE_NAME = 'dshify-probe';
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type LiveProbeStatus = 'verified' | 'unverified' | 'failed';

export interface LiveProbeOptions {
  /** Absolute repository root, used for the finding path and working directory. */
  readonly repoRoot: string;
  /** Absolute path to the installed `cordis.patch.yml`. */
  readonly patchPath: string;
  /** DSH executable; defaults to `$DSH_BIN` then `dsh` on `PATH`. */
  readonly bin?: string;
  /** Hard deadline for one DSH invocation. */
  readonly timeoutMs?: number;
}

export interface LiveProbeResult {
  readonly status: LiveProbeStatus;
  readonly dshVersion?: string;
  readonly expectedPresetIds: readonly string[];
  readonly seenPresetIds: readonly string[];
  readonly findings: readonly Finding[];
}

interface PresetIdentity {
  /** Loader row id, as declared in the patch. */
  readonly rowId: string;
  /** Preset identity saved by sessions (`config.id`). */
  readonly presetId: string;
}

const JS_TAG = { tag: '!!js', resolve: (value: string): string => value };

/** Read the preset rows a generated patch declares. */
export function presetIdentities(patchText: string): PresetIdentity[] {
  let document: unknown;
  try {
    document = parseYaml(patchText, { customTags: [JS_TAG as never] });
  } catch {
    return [];
  }
  if (!Array.isArray(document)) return [];
  const presets: PresetIdentity[] = [];
  for (const entry of document) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rows = (entry as { insert?: unknown }).insert;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      if (record['name'] !== '@deepseek-ai/dsh-agent-preset') continue;
      const rowId = record['id'];
      const config = record['config'];
      const presetId =
        typeof config === 'object' && config !== null
          ? (config as Record<string, unknown>)['id']
          : undefined;
      if (typeof rowId !== 'string' || typeof presetId !== 'string') continue;
      presets.push({ rowId, presetId });
    }
  }
  return presets;
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

function executableMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Compose the generated patch with the installed DSH in a temporary home.
 * Always resolves; every failure is reported as a finding plus a status.
 */
export async function probeComposedBundle(options: LiveProbeOptions): Promise<LiveProbeResult> {
  const bin = options.bin ?? process.env['DSH_BIN'] ?? 'dsh';
  const timeout = options.timeoutMs ?? 60_000;
  const label = repoRelative(options.repoRoot, options.patchPath);
  let patchText: string;
  try {
    patchText = await readFile(options.patchPath, 'utf8');
  } catch {
    return {
      status: 'unverified',
      expectedPresetIds: [],
      seenPresetIds: [],
      findings: [
        finding('LIVE_UNVERIFIED', 'no installed bundle patch to probe; run apply first', {
          path: label,
        }),
      ],
    };
  }

  const expected = presetIdentities(patchText);
  if (expected.length === 0) {
    return {
      status: 'unverified',
      expectedPresetIds: [],
      seenPresetIds: [],
      findings: [
        finding('LIVE_UNVERIFIED', 'the installed patch declares no agent preset rows', {
          path: label,
        }),
      ],
    };
  }

  const home = await mkdtemp(path.join(os.tmpdir(), 'dshify-live-'));
  const env = {
    ...process.env,
    DSH_HOME: home,
    NO_COLOR: '1',
  };
  try {
    let stdout: string;
    try {
      const result = await execFileAsync(
        bin,
        [
          '--profile',
          PROFILE_NAME,
          '--from-default-profile',
          'web',
          '--dump-config',
          '--patch',
          options.patchPath,
        ],
        {
          cwd: options.repoRoot,
          env,
          timeout,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      if (executableMissing(error)) {
        return {
          status: 'unverified',
          expectedPresetIds: expected.map((preset) => preset.presetId),
          seenPresetIds: [],
          findings: [
            finding(
              'LIVE_UNVERIFIED',
              `cannot run "${bin}" from PATH; install DSH or set DSH_BIN to probe the bundle`,
              { path: label },
            ),
          ],
        };
      }
      const stderr =
        typeof error === 'object' && error !== null
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : '';
      const timedOut =
        typeof error === 'object' &&
        error !== null &&
        ((error as { killed?: unknown }).killed === true ||
          (error as { signal?: unknown }).signal === 'SIGTERM');
      return {
        status: 'failed',
        expectedPresetIds: expected.map((preset) => preset.presetId),
        seenPresetIds: [],
        findings: [
          finding(
            'LIVE_PROBE_FAILED',
            timedOut
              ? `dsh --dump-config exceeded ${timeout}ms`
              : `dsh --dump-config exited nonzero: ${firstLine(stderr) || 'no diagnostic'}`,
            { path: label },
          ),
        ],
      };
    }

    const seen = expected.filter((preset) => stdout.includes(`- id: ${preset.rowId}`));
    const missing = expected.filter((preset) => !seen.includes(preset));
    const findings: Finding[] = [];
    for (const preset of missing) {
      findings.push(
        finding(
          'LIVE_PRESET_MISSING',
          `preset "${preset.presetId}" (row "${preset.rowId}") is absent from the composed roster`,
          { path: label },
        ),
      );
    }

    let dshVersion: string | undefined;
    try {
      const version = await execFileAsync(bin, ['--version'], {
        cwd: options.repoRoot,
        env,
        timeout,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      dshVersion = firstLine(version.stdout);
    } catch {
      dshVersion = undefined;
    }
    if (dshVersion !== undefined && dshVersion !== DISCOVERY_RULES.dshVersion) {
      findings.push(
        finding(
          'LIVE_VERSION_DRIFT',
          `installed DSH is ${dshVersion}; the checked rules mirror ${DISCOVERY_RULES.dshVersion}`,
          { path: label },
        ),
      );
    }

    return {
      status: missing.length === 0 ? 'verified' : 'failed',
      ...(dshVersion === undefined ? {} : { dshVersion }),
      expectedPresetIds: expected.map((preset) => preset.presetId),
      seenPresetIds: seen.map((preset) => preset.presetId),
      findings,
    };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
