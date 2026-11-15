#!/usr/bin/env node
/**
 * scripts/ci-watch.mjs
 *
 * Non-blocking, hard-timeout GitHub Actions CI watcher & stream-safe log slicer.
 * Prevents Windows PowerShell / gh CLI TTY hangs and multi-MB minified log OOM/pipe deadlocks.
 *
 * Usage:
 *   node scripts/ci-watch.mjs watch --run <runId> [--timeout-sec 900] [--poll-sec 20]
 *   node scripts/ci-watch.mjs watch --branch <branch> [--sha <sha>] [--timeout-sec 900] [--poll-sec 20]
 *   node scripts/ci-watch.mjs logs --run <runId> [--job <jobId>]
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HEADLESS_ENV = {
  ...process.env,
  CI: '1',
  GH_PAGER: 'cat',
  PAGER: 'cat',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
};

const MAX_LINE_CHARS = 280;
const PER_CALL_TIMEOUT_MS = 20_000;
const LOG_DOWNLOAD_TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const mode = argv[2] || 'help';
  const opts = {
    mode,
    runId: '',
    jobId: '',
    branch: '',
    sha: '',
    timeoutSec: 900,
    pollSec: 20,
    repo: '',
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--run' && next) {
      opts.runId = next;
      i += 1;
    } else if (arg === '--job' && next) {
      opts.jobId = next;
      i += 1;
    } else if (arg === '--branch' && next) {
      opts.branch = next;
      i += 1;
    } else if (arg === '--sha' && next) {
      opts.sha = next;
      i += 1;
    } else if (arg === '--timeout-sec' && next) {
      opts.timeoutSec = Math.max(30, Number.parseInt(next, 10) || 900);
      i += 1;
    } else if (arg === '--poll-sec' && next) {
      opts.pollSec = Math.max(5, Number.parseInt(next, 10) || 20);
      i += 1;
    } else if (arg === '--repo' && next) {
      opts.repo = next;
      i += 1;
    }
  }
  return opts;
}

function runGhJson(args, timeoutMs = PER_CALL_TIMEOUT_MS) {
  const res = spawnSync('gh', args, {
    env: HEADLESS_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });

  if (res.error) {
    throw new Error(`gh ${args.join(' ')} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} exited ${res.status}: ${(res.stderr || res.stdout || '').trim()}`);
  }
  return JSON.parse(res.stdout);
}

function resolveRepoSlug(explicitRepo) {
  if (explicitRepo) return explicitRepo;
  const res = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], {
    env: HEADLESS_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (res.status === 0 && res.stdout) {
    const parsed = JSON.parse(res.stdout);
    if (parsed.nameWithOwner) return parsed.nameWithOwner;
  }
  return 'Praneshrajan137/AI-File-Manager';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveRunId(opts) {
  if (opts.runId) return opts.runId;
  if (!opts.branch) {
    throw new Error('Provide either --run <id> or --branch <name>');
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const runs = runGhJson([
      'run',
      'list',
      '--branch',
      opts.branch,
      '--limit',
      '5',
      '--json',
      'databaseId,headSha,status,conclusion',
    ]);
    if (Array.isArray(runs) && runs.length > 0) {
      if (opts.sha) {
        const match = runs.find((r) => r.headSha && r.headSha.startsWith(opts.sha));
        if (match) return String(match.databaseId);
      } else {
        return String(runs[0].databaseId);
      }
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for GitHub Actions run on branch=${opts.branch} sha=${opts.sha || 'any'}`);
}

function formatLineSafe(line) {
  const clean = line.replace(/\r$/, '');
  if (clean.length <= MAX_LINE_CHARS) return clean;
  return `${clean.slice(0, MAX_LINE_CHARS)} ... [TRUNCATED ${clean.length} chars]`;
}

function streamFailedJobLog(repoSlug, jobId, jobName) {
  return new Promise((resolve) => {
    const outPath = path.join(os.tmpdir(), `ci-job-${jobId}.log`);
    const outStream = fs.createWriteStream(outPath, { encoding: 'utf8' });
    const child = spawn('gh', ['api', `repos/${repoSlug}/actions/jobs/${jobId}/logs`], {
      env: HEADLESS_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    let carry = '';
    const highlights = [];
    const tail = [];
    const MAX_TAIL = 45;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }, LOG_DOWNLOAD_TIMEOUT_MS);

    function handleLine(rawLine) {
      const safe = formatLineSafe(rawLine);
      outStream.write(`${safe}\n`);
      tail.push(safe);
      if (tail.length > MAX_TAIL) tail.shift();

      if (
        /##\[error\]|Error:|SecurityError|FileSystemError|FAIL\s+tests|Tests:\s+\d+ failed|\d+\)\s+\[electron\]|failed\)|passed \(|ASSERT|Process completed with exit code/i.test(
          safe
        )
      ) {
        if (highlights.length < 60) {
          highlights.push(safe);
        }
      }
    }

    child.stdout.on('data', (chunk) => {
      const text = carry + chunk.toString('utf8');
      const parts = text.split('\n');
      carry = parts.pop() || '';
      for (const part of parts) {
        handleLine(part);
      }
    });

    let errText = '';
    child.stderr.on('data', (chunk) => {
      if (errText.length < 2000) errText += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (carry) handleLine(carry);
      outStream.end();
      resolve({
        jobId,
        jobName,
        outPath,
        code,
        timedOut,
        errText: errText.trim(),
        highlights,
        tail,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      outStream.end();
      resolve({
        jobId,
        jobName,
        outPath,
        code: -1,
        timedOut,
        errText: err.message,
        highlights,
        tail,
      });
    });
  });
}

async function printFailedJobSummaries(repoSlug, runDetails, specificJobId) {
  const jobs = Array.isArray(runDetails.jobs) ? runDetails.jobs : [];
  const failedJobs = specificJobId
    ? jobs.filter((j) => String(j.databaseId) === String(specificJobId))
    : jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'cancelled' || j.conclusion === 'timed_out');

  if (failedJobs.length === 0) {
    console.log('No failed jobs matched.');
    return;
  }

  for (const job of failedJobs) {
    console.log(`\n=== FAILED JOB: ${job.name} (id=${job.databaseId}, conclusion=${job.conclusion}) ===`);
    const failedSteps = (job.steps || []).filter((s) => s.conclusion === 'failure');
    if (failedSteps.length > 0) {
      console.log(`Failed steps: ${failedSteps.map((s) => s.name).join(', ')}`);
    }
    const summary = await streamFailedJobLog(repoSlug, job.databaseId, job.name);
    console.log(`Saved stripped log to: ${summary.outPath}${summary.timedOut ? ' [PARTIAL: stream timeout]' : ''}`);
    if (summary.errText) {
      console.log(`stderr: ${summary.errText}`);
    }
    const linesToPrint = summary.highlights.length > 0 ? summary.highlights : summary.tail;
    for (const line of linesToPrint) {
      console.log(`  ${line}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.mode !== 'watch' && opts.mode !== 'logs') {
    console.log('Usage: node scripts/ci-watch.mjs <watch|logs> --run <id> | --branch <branch> [--sha <sha>] [--timeout-sec 900]');
    process.exit(0);
  }

  const repoSlug = resolveRepoSlug(opts.repo);
  const runId = await resolveRunId(opts);

  if (opts.mode === 'logs') {
    const details = runGhJson(['run', 'view', runId, '--json', 'status,conclusion,url,jobs']);
    console.log(`Run ${runId}: status=${details.status} conclusion=${details.conclusion} url=${details.url}`);
    await printFailedJobSummaries(repoSlug, details, opts.jobId);
    process.exit(details.conclusion === 'success' ? 0 : 1);
  }

  const startedAt = Date.now();
  const deadline = startedAt + opts.timeoutSec * 1000;
  let consecutiveErrors = 0;

  console.log(`Watching CI run ${runId} (repo=${repoSlug}, timeout=${opts.timeoutSec}s, poll=${opts.pollSec}s)...`);

  while (Date.now() < deadline) {
    let details;
    try {
      details = runGhJson(['run', 'view', runId, '--json', 'status,conclusion,url,jobs']);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors += 1;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.error(`[${elapsed}s] Poll error (${consecutiveErrors}/5): ${err.message}`);
      if (consecutiveErrors >= 5) {
        console.error('Aborting CI watch after 5 consecutive API errors.');
        process.exit(1);
      }
      await sleep(opts.pollSec * 1000);
      continue;
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const jobSummary = (details.jobs || [])
      .map((j) => `${j.name}=${j.conclusion || j.status}`)
      .join(' | ');
    console.log(`[${elapsed}s] run=${details.status}/${details.conclusion || '-'} :: ${jobSummary}`);

    if (details.status === 'completed') {
      if (details.conclusion === 'success') {
        console.log(`SUCCESS: Run ${runId} passed (${details.url}).`);
        process.exit(0);
      }
      console.error(`FAILURE: Run ${runId} finished with conclusion=${details.conclusion} (${details.url}).`);
      await printFailedJobSummaries(repoSlug, details, opts.jobId);
      process.exit(1);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(opts.pollSec * 1000, remainingMs));
  }

  console.error(`TIMEOUT: Run ${runId} did not complete within ${opts.timeoutSec}s.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
