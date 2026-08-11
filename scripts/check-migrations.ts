import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export type MigrationRule =
  | 'missing-final-semicolon'
  | 'duplicate-prefix'
  | 'unbalanced-dollar-quote'
  | 'create-function-without-or-replace';

export type MigrationViolation = {
  file: string;
  line: number;
  rule: MigrationRule;
  message: string;
};

export type MigrationCheckResult = {
  filesChecked: number;
  violations: MigrationViolation[];
};

type MigrationFile = {
  path: string;
  name: string;
  prefix: string;
  sql: string;
};

type FunctionDeclaration = {
  name: string;
  hasOrReplace: boolean;
  line: number;
};

export function checkMigrations(migrationsDir = join(process.cwd(), 'supabase', 'migrations')): MigrationCheckResult {
  if (!existsSync(migrationsDir)) {
    return {
      filesChecked: 0,
      violations: [
        {
          file: migrationsDir,
          line: 1,
          rule: 'missing-final-semicolon',
          message: `Migration directory not found: ${migrationsDir}`,
        },
      ],
    };
  }

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name): MigrationFile => ({
      path: join(migrationsDir, name),
      name,
      prefix: getNumericPrefix(name),
      sql: readFileSync(join(migrationsDir, name), 'utf8'),
    }));

  const violations: MigrationViolation[] = [];
  violations.push(...checkDuplicatePrefixes(files));

  const seenFunctions = new Set<string>();

  for (const file of files) {
    violations.push(...checkFinalSemicolon(file));
    violations.push(...checkDollarQuotes(file));

    for (const declaration of findFunctionDeclarations(file.sql)) {
      if (!declaration.hasOrReplace && seenFunctions.has(declaration.name)) {
        violations.push({
          file: file.path,
          line: declaration.line,
          rule: 'create-function-without-or-replace',
          message: `CREATE FUNCTION for previously declared function "${declaration.name}" must use OR REPLACE`,
        });
      }

      seenFunctions.add(declaration.name);
    }
  }

  return {
    filesChecked: files.length,
    violations,
  };
}

function getNumericPrefix(fileName: string): string {
  return fileName.match(/^(\d+)/)?.[1] ?? fileName;
}

function checkDuplicatePrefixes(files: MigrationFile[]): MigrationViolation[] {
  const firstByPrefix = new Map<string, MigrationFile>();
  const violations: MigrationViolation[] = [];

  for (const file of files) {
    const first = firstByPrefix.get(file.prefix);
    if (first) {
      violations.push({
        file: file.path,
        line: 1,
        rule: 'duplicate-prefix',
        message: `Duplicate migration numeric prefix "${file.prefix}" also used by ${first.name}`,
      });
      continue;
    }

    firstByPrefix.set(file.prefix, file);
  }

  return violations;
}

function checkFinalSemicolon(file: MigrationFile): MigrationViolation[] {
  const lines = file.sql.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '' || trimmed.startsWith('--')) {
      continue;
    }

    if (!trimmed.endsWith(';')) {
      return [
        {
          file: file.path,
          line: index + 1,
          rule: 'missing-final-semicolon',
          message: 'Last meaningful migration line must end with a semicolon',
        },
      ];
    }

    return [];
  }

  return [];
}

function checkDollarQuotes(file: MigrationFile): MigrationViolation[] {
  const occurrences = new Map<string, number[]>();
  const tagPattern = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g;
  const lines = file.sql.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(tagPattern)) {
      const tag = match[0];
      const seen = occurrences.get(tag) ?? [];
      seen.push(index + 1);
      occurrences.set(tag, seen);
    }
  }

  const violations: MigrationViolation[] = [];

  for (const [tag, linesSeen] of occurrences) {
    if (linesSeen.length % 2 !== 0) {
      violations.push({
        file: file.path,
        line: linesSeen[0],
        rule: 'unbalanced-dollar-quote',
        message: `Dollar-quote tag ${tag} appears ${linesSeen.length} time(s), expected an even count`,
      });
    }
  }

  return violations;
}

function findFunctionDeclarations(sql: string): FunctionDeclaration[] {
  const stripped = stripSqlComments(sql);
  const declarations: FunctionDeclaration[] = [];
  const pattern = /\bcreate\s+(or\s+replace\s+)?function\s+((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)/gi;

  for (const match of stripped.matchAll(pattern)) {
    declarations.push({
      name: normalizeFunctionName(match[2]),
      hasOrReplace: Boolean(match[1]),
      line: lineNumberAt(stripped, match.index ?? 0),
    });
  }

  return declarations;
}

function stripSqlComments(sql: string): string {
  let result = '';

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      result += '  ';
      index += 2;
      while (index < sql.length && sql[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < sql.length) {
        if (sql[index] === '*' && sql[index + 1] === '/') {
          result += '  ';
          index += 1;
          break;
        }

        result += sql[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    result += char;
  }

  return result;
}

function normalizeFunctionName(rawName: string): string {
  return rawName
    .split('.')
    .map((part) => part.trim().replace(/^"|"$/g, '').toLowerCase())
    .join('.');
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === '\n') {
      line += 1;
    }
  }
  return line;
}

function formatViolation(violation: MigrationViolation): string {
  const displayPath = relative(process.cwd(), violation.file).replace(/\\/g, '/');
  return `${displayPath}:${violation.line}: ${violation.rule} - ${violation.message}`;
}

if (require.main === module) {
  const result = checkMigrations();

  if (result.violations.length > 0) {
    console.error('Migration check failed:');
    for (const violation of result.violations) {
      console.error(formatViolation(violation));
    }
    process.exitCode = 1;
  } else {
    console.log(`Migration check passed: ${result.filesChecked} files checked.`);
  }
}
