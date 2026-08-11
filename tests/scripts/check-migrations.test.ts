import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkMigrations } from '../../scripts/check-migrations';

function withMigrations(
  files: Record<string, string>,
  run: (dir: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), 'check-migrations-'));

  try {
    for (const [name, sql] of Object.entries(files)) {
      writeFileSync(join(dir, name), sql, 'utf8');
    }

    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('checkMigrations', () => {
  it('fails when the last meaningful migration line does not end with a semicolon', () => {
    withMigrations(
      {
        '20240101000000_bad.sql': [
          'create or replace function public.bad()',
          'returns void',
          'language sql',
          'as $function$ select 1 $function$',
          '',
          '-- trailing comment',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([
          expect.objectContaining({
            rule: 'missing-final-semicolon',
            file: expect.stringContaining('20240101000000_bad.sql'),
            line: 4,
          }),
        ]);
      },
    );
  });

  it('allows a migration whose last meaningful line ends with a semicolon', () => {
    withMigrations(
      {
        '20240101000000_good.sql': [
          'create table public.good (id uuid primary key);',
          '',
          '-- trailing comment',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([]);
      },
    );
  });

  it('fails when two migrations share the same numeric prefix', () => {
    withMigrations(
      {
        '20240101000000_one.sql': 'select 1;\n',
        '20240101000000_two.sql': 'select 2;\n',
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([
          expect.objectContaining({
            rule: 'duplicate-prefix',
            file: expect.stringContaining('20240101000000_two.sql'),
            line: 1,
          }),
        ]);
      },
    );
  });

  it('allows unique migration numeric prefixes', () => {
    withMigrations(
      {
        '20240101000000_one.sql': 'select 1;\n',
        '20240101000001_two.sql': 'select 2;\n',
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([]);
      },
    );
  });

  it('fails when a dollar-quote tag is unbalanced', () => {
    withMigrations(
      {
        '20240101000000_bad.sql': [
          'create or replace function public.bad()',
          'returns void',
          'language plpgsql',
          'as $function$',
          'begin',
          '  null;',
          'end;',
          '$missing$;',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([
          expect.objectContaining({
            rule: 'unbalanced-dollar-quote',
            file: expect.stringContaining('20240101000000_bad.sql'),
            line: 4,
          }),
          expect.objectContaining({
            rule: 'unbalanced-dollar-quote',
            file: expect.stringContaining('20240101000000_bad.sql'),
            line: 8,
          }),
        ]);
      },
    );
  });

  it('allows balanced dollar-quote tags', () => {
    withMigrations(
      {
        '20240101000000_good.sql': [
          'create or replace function public.good()',
          'returns void',
          'language plpgsql',
          'as $function$',
          'begin',
          '  null;',
          'end;',
          '$function$;',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([]);
      },
    );
  });

  it('fails when CREATE FUNCTION omits OR REPLACE for a function seen in an older migration', () => {
    withMigrations(
      {
        '20240101000000_old.sql': [
          'create or replace function public.reused()',
          'returns int',
          'language sql',
          'as $$ select 1 $$;',
        ].join('\n'),
        '20240101000001_new.sql': [
          'create function public.reused()',
          'returns int',
          'language sql',
          'as $$ select 2 $$;',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([
          expect.objectContaining({
            rule: 'create-function-without-or-replace',
            file: expect.stringContaining('20240101000001_new.sql'),
            line: 1,
          }),
        ]);
      },
    );
  });

  it('allows CREATE OR REPLACE FUNCTION for a function seen in an older migration', () => {
    withMigrations(
      {
        '20240101000000_old.sql': [
          'create or replace function public.reused()',
          'returns int',
          'language sql',
          'as $$ select 1 $$;',
        ].join('\n'),
        '20240101000001_new.sql': [
          'create or replace function public.reused()',
          'returns int',
          'language sql',
          'as $$ select 2 $$;',
        ].join('\n'),
      },
      (dir) => {
        expect(checkMigrations(dir).violations).toEqual([]);
      },
    );
  });
});
