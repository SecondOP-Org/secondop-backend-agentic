import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { GoldCase, GoldSubset, parseGoldCase } from './schema';

const defaultCasesRoot = path.join(__dirname, 'cases');

const walkJsonFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
    } else if (entry.endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
};

export interface LoadGoldCasesOptions {
  casesRoot?: string;
  goldSetVersion?: string;
  subset?: GoldSubset | 'all';
}

export const loadGoldCases = (options: LoadGoldCasesOptions = {}): GoldCase[] => {
  const casesRoot = options.casesRoot || defaultCasesRoot;
  const files = walkJsonFiles(casesRoot);
  const cases = files.map((filePath) => {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return parseGoldCase(raw);
  });

  return cases
    .filter((goldCase) =>
      options.goldSetVersion ? goldCase.labels.goldSetVersion === options.goldSetVersion : true
    )
    .filter((goldCase) => {
      if (!options.subset || options.subset === 'all') return true;
      if (options.subset === 'smoke') return goldCase.subset === 'smoke';
      return true; // full = all cases
    })
    .sort((a, b) => a.id.localeCompare(b.id));
};
