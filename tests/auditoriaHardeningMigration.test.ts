// tests/auditoriaHardeningMigration.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const MIGRATION_PATH = path.join(
  ROOT_DIR,
  'supabase',
  'migrations',
  '20261126_hardening_auditoria_e_rpcs_integracao.sql'
);

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

test('migration de hardening da auditoria existe, usa transação idempotente e recarrega o schema do PostgREST', () => {
  const sql = readMigrationSql();

  assert.match(sql, /\bBEGIN;/);
  assert.match(sql, /\bCOMMIT;/);
  assert.match(sql, /NOTIFY\s+pgrst,\s*'reload schema';/i);
  assert.match(sql, /\bDO\s+\$\$/);
  assert.match(sql, /pg_class/);
  assert.match(sql, /to_regprocedure\(/);
  assert.match(sql, /DROP POLICY IF EXISTS\s+"historico_alteracoes_select_policy"\s+ON\s+public\.historico_alteracoes_dados/i);
  assert.match(sql, /DROP POLICY IF EXISTS\s+"solicitacoes_alteracao_select_policy"\s+ON\s+public\.solicitacoes_alteracao_externa/i);
  assert.match(sql, /ALTER TABLE public\.historico_alteracoes_dados ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /ALTER TABLE public\.solicitacoes_alteracao_externa ENABLE ROW LEVEL SECURITY/i);
});

test('migration revoga privilégios de PUBLIC, anon e authenticated sobre tabelas e view de auditoria', () => {
  const sql = readMigrationSql();

  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.historico_alteracoes_dados FROM PUBLIC,\s*anon,\s*authenticated/i
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.solicitacoes_alteracao_externa FROM PUBLIC,\s*anon,\s*authenticated/i
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

test('código da aplicação e rotas de API não dependem de acesso autenticado direto às RPCs/view revogadas e mantêm limite de 12 funções em api/', () => {
  const runtimeFiles = [
    ...listFilesRecursive(path.join(ROOT_DIR, 'src')),
    ...listFilesRecursive(path.join(ROOT_DIR, 'api'))
  ].filter(file => /\.(ts|tsx|js|jsx)$/i.test(file));

  const forbiddenRuntimeRefs = [
    'listar_historico_alteracoes',
    'vw_historico_alteracoes_dados',
    'integracao_inserir_registro',
    'integracao_solicitar_edicao'
  ];

  for (const file of runtimeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const ref of forbiddenRuntimeRefs) {
      assert.equal(
        content.includes(ref),
        false,
        `Referência inesperada a ${ref} em ${path.relative(ROOT_DIR, file)}`
      );
    }
  }

  const apiFiles = listFilesRecursive(path.join(ROOT_DIR, 'api')).filter(file =>
    /\.ts$/i.test(file)
  );
  assert.ok(apiFiles.length <= 12, `Limite de 12 funções em api/ excedido: ${apiFiles.length}`);
});
