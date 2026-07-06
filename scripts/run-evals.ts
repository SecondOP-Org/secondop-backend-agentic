import { runContractEvalHarness } from '../src/evals/contractEvalHarness';
import { runCriticEvalHarness } from '../src/evals/criticEvalHarness';

const main = async () => {
  const contractResults = runContractEvalHarness();
  const criticResults = await runCriticEvalHarness();

  const contractFailed = contractResults.filter((result) => result.expectedPass !== result.actualPass).length;
  const criticFailed = criticResults.filter((result) => result.expectedPass !== result.actualPass).length;

  const summary = {
    contract: {
      total: contractResults.length,
      passed: contractResults.length - contractFailed,
      failed: contractFailed,
      results: contractResults,
    },
    critic: {
      total: criticResults.length,
      passed: criticResults.length - criticFailed,
      failed: criticFailed,
      results: criticResults,
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (contractFailed > 0 || criticFailed > 0) {
    process.exitCode = 1;
  }
};

void main();
