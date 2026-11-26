// tests/auditoriaHardeningMigration.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');
const MIGRATION_FILENAME = '20261126_hardening_auditoria_e_rpcs_integracao.sql';
const MIGRATION_PATH = path.join(MIGRATIONS_DIR, MIGRATION_FILENAME);

function readMigrationSql(): string {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

function listFilesRecursive(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

test('migration de hardening segue padrão e ordem cronológica após migrations existentes', () => {
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  const idx20261116 = migrationFiles.indexOf('20261116_historico_alteracoes_e_integracao_externa.sql');
  const idx20261119 = migrationFiles.indexOf('20261119_api_v2_s2s_alinhamento_esquema.sql');
  const idxCurrent = migrationFiles.indexOf(MIGRATION_FILENAME);

  assert.notEqual(idx20261116, -1);
  assert.notEqual(idx20261119, -1);
  assert.notEqual(idxCurrent, -1);
  assert.ok(idxCurrent > idx20261116);
  assert.ok(idxCurrent > idx20261119);
  assert.equal(idxCurrent, migrationFiles.length - 1);

  const sql = readMigrationSql();
  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;/);
  assert.match(sql, /NOTIFY\s+pgrst,\s*'reload schema';/i);
  assert.match(sql, /\bDO\s+\$\$/);
  assert.match(sql, /pg_class/);
  assert.match(sql, /pg_policies/);
  assert.match(sql, /to_regprocedure\(/);
});

test('migration ativa RLS, remove todas as políticas via pg_policies e revoga privilégios de PUBLIC, anon e authenticated', () => {
  const sql = readMigrationSql();

  assert.match(
    sql,
    /ARRAY\['historico_alteracoes_dados',\s*'solicitacoes_alteracao_externa'\]/i
  );
  assert.match(
    sql,
    /ENABLE ROW LEVEL SECURITY/i
  );
  assert.match(
    sql,
    /FROM pg_policies p[\s\S]*p\.schemaname\s*=\s*'public'[\s\S]*p\.tablename\s*=\s*v_table_name/i
  );
  assert.match(
    sql,
    /DROP POLICY IF EXISTS %I ON public\.%I/i
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.%I FROM PUBLIC,\s*anon,\s*authenticated/i
  );
  assert.match(
    sql,
    /REVOKE ALL ON public\.vw_historico_alteracoes_dados FROM PUBLIC,\s*anon,\s*authenticated/i
  );
});

test('migration revoga EXECUTE de PUBLIC, anon e authenticated nas assinaturas reais confirmadas das RPCs', () => {
  const sql = readMigrationSql();

  const expectedSignatures = [
    'public.listar_historico_alteracoes(text, text, text, text, integer, integer)',
    'public.integracao_inserir_registro(text, text, text, jsonb, text)',
    'public.integracao_solicitar_edicao(text, text, text, text, jsonb, text, text, text)'
  ];

  for (const sig of expectedSignatures) {
    const escapedSig = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      sql,
      new RegExp(`to_regprocedure\\('${escapedSig}'\\)\\s+IS NOT NULL`, 'i'),
      `Guarda idempotente ausente para ${sig}`
    );
    assert.match(
      sql,
      new RegExp(
        `REVOKE EXECUTE ON FUNCTION ${escapedSig} FROM PUBLIC,\\s*anon,\\s*authenticated`,
        'i'
      ),
      `Revogação de EXECUTE ausente para ${sig}`
    );
  }
});

test('migration preserva service_role, não concede novos acessos e documenta exigência de camada server-side sanitizada', () => {
  const sql = readMigrationSql();
  const sqlWithoutComments = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.equal(/\bGRANT\b/i.test(sqlWithoutComments), false, 'Migration não deve conceder novos privilégios');
  assert.equal(
    /REVOKE\b[^;]*\bservice_role\b/i.test(sqlWithoutComments),
    false,
    'Migration não deve revogar privilégios de service_role'
  );

  assert.match(sql, /camada server-side autorizada/i);
  assert.match(sql, /sanitizada/i);
  assert.match(sql, /(?:nunca|jamais)\s+(?:expor|expondo)\s+snapshots\s+brutos/i);
});

test('src/, api/ e supabase/functions/ não dependem de acesso autenticado às RPCs/view/tabelas revogadas e api/ mantém exatamente 12 funções', () => {
  const runtimeFiles = [
    ...listFilesRecursive(path.join(ROOT_DIR, 'src')),
    ...listFilesRecursive(path.join(ROOT_DIR, 'api')),
    ...listFilesRecursive(path.join(ROOT_DIR, 'supabase', 'functions'))
  ].filter(file => /\.(ts|tsx|js|jsx)$/i.test(file));

  const forbiddenRuntimeRefs = [
    'listar_historico_alteracoes',
    'vw_historico_alteracoes_dados',
    'integracao_inserir_registro',
    'integracao_solicitar_edicao',
    'solicitacoes_alteracao_externa'
  ];

  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT_DIR, file).replace(/\\/g, '/');

    for (const ref of forbiddenRuntimeRefs) {
      assert.equal(
        content.includes(ref),
        false,
        `Referência inesperada a ${ref} em ${rel}`
      );
    }

    if (content.includes('historico_alteracoes_dados')) {
      assert.equal(
        rel,
        'supabase/functions/admin-manage-user/handler.ts',
        `Referência inesperada a historico_alteracoes_dados em ${rel}`
      );
      assert.match(
        content,
        /supabaseAdmin\?\.\s*from\?\.\('historico_alteracoes_dados'\)/,
        'Uso de historico_alteracoes_dados em Edge Function deve ocorrer apenas via supabaseAdmin (service_role)'
      );
    }
  }

  const apiFiles = listFilesRecursive(path.join(ROOT_DIR, 'api')).filter(file =>
    /\.ts$/i.test(file)
  );
  assert.equal(apiFiles.length, 12, `Esperadas exatamente 12 funções em api/, encontrado: ${apiFiles.length}`);
});
