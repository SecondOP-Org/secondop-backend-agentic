import { writeFileSync } from 'fs';
import { runGoldEvalHarness, GoldEngine } from '../src/evals/goldEvalHarness';

const parseArgs = (argv: string[]) => {
  const get = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const hit = argv.find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };

  const engineRaw = get('engine') || 'both';
  const engines: GoldEngine[] | 'both' =
    engineRaw === 'both' ? 'both' : engineRaw === 'baseline' || engineRaw === 'agentic' ? [engineRaw] : 'both';

  return {
    engines,
    subset: (get('subset') as 'smoke' | 'full' | undefined) || 'full',
    version: get('version'),
    jsonOut: get('json-out'),
    scoreOnly: argv.includes('--score-only'),
    skipJudge: argv.includes('--skip-judge'),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const report = await runGoldEvalHarness({
    engines: args.engines,
    subset: args.subset,
    goldSetVersion: args.version,
    scoreOnly: args.scoreOnly,
    skipJudge: args.skipJudge || args.scoreOnly,
  });

  const json = JSON.stringify(report, null, 2);
  process.stdout.write(`${json}\n`);

  if (args.jsonOut) {
    writeFileSync(args.jsonOut, `${json}\n`, 'utf8');
  }

  if (!report.gatePassed) {
    process.stderr.write(`Gold eval gate failed:\n${report.gateFailures.map((f) => `- ${f}`).join('\n')}\n`);
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
