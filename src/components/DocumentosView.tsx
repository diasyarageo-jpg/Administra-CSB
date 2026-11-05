import React, { useEffect, useMemo, useState } from 'react';
import {
  DOCUMENTO_TIPOS_PADRAO,
  DocumentoCatalogoItem,
  DocumentoOrigem,
  DocumentoTipoConfig,
  OrigemSyncStatus
} from '../types/documentos';
import {
  abrirDocumentoOriginal,
  AdministraCommonData,
  baixarDocumentoOriginal,
  carregarCatalogoDocumentos,
  filterAndSortDocumentos
} from '../services/documentosService';

interface DocumentosViewProps {
  commonData: AdministraCommonData;
  tiposConfiguraveis?: DocumentoTipoConfig[];
  onNotify?: (msg: string) => void;
}

const ORIGEM_BADGE_CLASS: Record<DocumentoOrigem, string> = {
  Classifica: 'blue',
  Notifica: 'amber',
  Fiscaliza: 'green'
};

function formatDateBr(iso?: string): string {
  if (!iso) return '—';
  const clean = iso.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateTimeBr(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export const DocumentosView: React.FC<DocumentosViewProps> = ({
  commonData,
  tiposConfiguraveis = DOCUMENTO_TIPOS_PADRAO,
  onNotify
}) => {
  const [documentos, setDocumentos] = useState<DocumentoCatalogoItem[]>([]);
  const [origensStatus, setOrigensStatus] = useState<OrigemSyncStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [actionAlert, setActionAlert] = useState<{
    titulo: string;
    mensagem: string;
    indisponivel?: boolean;
  } | null>(null);

  // Filtros e ordenação
  const [busca, setBusca] = useState('');
  const [origemFiltro, setOrigemFiltro] = useState<DocumentoOrigem | 'Todas'>('Todas');
  const [tipoFiltro, setTipoFiltro] = useState<string>('Todos');
  const [dataInicio, setDataInicio] = useState<string>('');
  const [dataFim, setDataFim] = useState<string>('');
  const [analistaFiltro, setAnalistaFiltro] = useState<string>('');
  const [ordenarPor, setOrdenarPor] = useState<'data' | 'titulo' | 'origem' | 'empreendedor'>('data');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');

  // Detalhe do documento (somente leitura)
  const [selectedDoc, setSelectedDoc] = useState<DocumentoCatalogoItem | null>(null);
  const [accessingDocId, setAccessingDocId] = useState<string | null>(null);

  const sincronizar = async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const res = await carregarCatalogoDocumentos(commonData);
      setDocumentos(res.documentos);
      setOrigensStatus(res.origensStatus);
      if (res.erroGeral) {
        setSyncError(res.erroGeral);
      }
    } catch (err: any) {
      setSyncError(err?.message || 'Erro inesperado ao consultar o catálogo de documentos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    sincronizar();
  }, [commonData.empreendedores.length, commonData.barragens.length, commonData.rts.length]);

  const filteredDocs = useMemo(() => {
    return filterAndSortDocumentos(documentos, {
      busca,
      origem: origemFiltro,
      tipoCodigo: tipoFiltro,
      dataInicio,
      dataFim,
      analista: analistaFiltro,
      ordenarPor,
      direcao
    });
  }, [
    documentos,
    busca,
    origemFiltro,
    tipoFiltro,
    dataInicio,
    dataFim,
    analistaFiltro,
    ordenarPor,
    direcao
  ]);

  const hasActiveFilters = Boolean(
    busca.trim() ||
      origemFiltro !== 'Todas' ||
      tipoFiltro !== 'Todos' ||
      dataInicio ||
      dataFim ||
      analistaFiltro.trim()
  );

  const clearFilters = () => {
    setBusca('');
    setOrigemFiltro('Todas');
    setTipoFiltro('Todos');
    setDataInicio('');
    setDataFim('');
    setAnalistaFiltro('');
  };

  const handleOpenOriginal = async (doc: DocumentoCatalogoItem) => {
    setAccessingDocId(doc.id);
    setActionAlert(null);
    try {
      const res = await abrirDocumentoOriginal(doc);
      if (res.sucesso && res.urlTemporaria) {
        window.open(res.urlTemporaria, '_blank', 'noopener,noreferrer');
      } else {
        const msg =
          res.mensagemErro ||
          `Não foi possível abrir o documento original no sistema ${doc.origemSistema}.`;
        setActionAlert({
          titulo: `Documento indisponível (${doc.origemSistema})`,
          mensagem: msg,
          indisponivel: res.indisponivelNaOrigem
        });
        onNotify?.(msg);
      }
    } finally {
      setAccessingDocId(null);
    }
  };

  const handleDownloadOriginal = async (doc: DocumentoCatalogoItem) => {
    setAccessingDocId(doc.id);
    setActionAlert(null);
    try {
      const res = await baixarDocumentoOriginal(doc);
      if (res.sucesso && res.urlTemporaria) {
        const a = document.createElement('a');
        a.href = res.urlTemporaria;
        a.download = res.nomeArquivo || `${doc.titulo}.pdf`;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const msg =
          res.mensagemErro ||
          `Não foi possível baixar o documento original no sistema ${doc.origemSistema}.`;
        setActionAlert({
          titulo: `Download indisponível (${doc.origemSistema})`,
          mensagem: msg,
          indisponivel: res.indisponivelNaOrigem
        });
        onNotify?.(msg);
      }
    } finally {
      setAccessingDocId(null);
    }
  };

  const origensComFalha = origensStatus.filter(s => !s.conectado && s.erro);

  return (
    <div>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Catálogo Central · Consulta Federada</div>
          <h2>Documentos</h2>
          <p>
            Consulta centralizada de documentos gerados no Classifica, Notifica e Fiscaliza,
            relacionados aos cadastros do Administra. Os arquivos originais permanecem nos sistemas
            de origem.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn light"
            onClick={sincronizar}
            disabled={loading}
          >
            {loading ? 'Sincronizando...' : '↻ Atualizar catálogo'}
          </button>
        </div>
      </div>

      {/* Cards de Status por Sistema de Origem */}
      <div className="stats">
        <div className="stat">
          <div>
            <div className="label">Total no Catálogo</div>
            <div className="value">{documentos.length}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
              Somente consulta
            </div>
          </div>
          <div className="stat-ico">▤</div>
        </div>

        {(['Classifica', 'Notifica', 'Fiscaliza'] as DocumentoOrigem[]).map(origem => {
          const st = origensStatus.find(s => s.origem === origem);
          const count = st?.totalDocumentos ?? 0;
          const conectado = Boolean(st?.conectado);
          return (
            <div
              key={origem}
              className="stat"
              style={{ cursor: 'pointer' }}
              onClick={() =>
                setOrigemFiltro(prev => (prev === origem ? 'Todas' : origem))
              }
              title={`Filtrar documentos de ${origem}`}
            >
              <div style={{ minWidth: 0 }}>
                <div className="label">{origem}</div>
                <div className="value">{count}</div>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: conectado ? '#059669' : '#b45309',
                    marginTop: '3px'
                  }}
                >
                  {conectado ? '● Integrado' : '○ Aguardando conexão'}
                </div>
              </div>
              <div className="stat-ico">
                {origem === 'Classifica' ? '◈' : origem === 'Notifica' ? '✉' : '⚑'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Aviso de Indisponibilidade Parcial de Origens (sem bloquear consulta às demais) */}
      {!loading && origensComFalha.length > 0 && (
        <div className="notice amber" style={{ marginBottom: '16px' }}>
          <strong style={{ display: 'block', marginBottom: '4px' }}>
            Status de Integração com Sistemas de Origem:
          </strong>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {origensComFalha.map(st => (
              <li key={st.origem} style={{ marginBottom: '2px' }}>
                <b>{st.origem}:</b> {st.erro}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Erro Geral de Sincronização */}
      {syncError && (
        <div
          className="notice"
          style={{
            marginBottom: '16px',
            background: '#fff1f2',
            borderColor: '#fecdd3',
            color: '#be123c'
          }}
        >
          <strong>Erro de sincronização:</strong> {syncError}
        </div>
      )}

      {/* Alerta de Documento Indisponível ao Tentar Abrir/Baixar */}
      {actionAlert && (
        <div
          className="notice amber"
          style={{
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px'
          }}
        >
          <div>
            <strong style={{ display: 'block', marginBottom: '2px' }}>
              {actionAlert.titulo}
            </strong>
            <span>{actionAlert.mensagem}</span>
          </div>
          <button
            type="button"
            className="iconbtn"
            onClick={() => setActionAlert(null)}
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* Painel Principal de Consulta */}
      <div className="panel">
        <div className="toolbar">
          <div className="field-search">
            <span>⌕</span>
            <input
              className="input"
              placeholder="Buscar por título, número, empreendedor, CPF/CNPJ, processo ou CAR/MT..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>

          <select
            className="select filter"
            value={origemFiltro}
            onChange={e => setOrigemFiltro(e.target.value as DocumentoOrigem | 'Todas')}
            aria-label="Filtrar por sistema de origem"
          >
            <option value="Todas">Todas as origens</option>
            <option value="Classifica">Classifica</option>
            <option value="Notifica">Notifica</option>
            <option value="Fiscaliza">Fiscaliza</option>
          </select>

          <select
            className="select filter"
            value={tipoFiltro}
            onChange={e => setTipoFiltro(e.target.value)}
            aria-label="Filtrar por tipo de documento"
          >
            <option value="Todos">Todos os tipos</option>
            {tiposConfiguraveis
              .filter(t => t.ativo)
              .map(t => (
                <option key={t.codigo} value={t.codigo}>
                  {t.nome}
                </option>
              ))}
          </select>

          <input
            type="text"
            className="input filter"
            placeholder="Analista / RT..."
            value={analistaFiltro}
            onChange={e => setAnalistaFiltro(e.target.value)}
            aria-label="Filtrar por analista ou elaborador"
          />

          <input
            type="date"
            className="input filter"
            value={dataInicio}
            onChange={e => setDataInicio(e.target.value)}
            title="Data inicial de emissão"
            aria-label="Data inicial"
          />

          <input
            type="date"
            className="input filter"
            value={dataFim}
            onChange={e => setDataFim(e.target.value)}
            title="Data final de emissão"
            aria-label="Data final"
          />

          <select
            className="select filter"
            value={`${ordenarPor}:${direcao}`}
            onChange={e => {
              const [ord, dir] = e.target.value.split(':') as [
                'data' | 'titulo' | 'origem' | 'empreendedor',
                'asc' | 'desc'
              ];
              setOrdenarPor(ord);
              setDirecao(dir);
            }}
            aria-label="Ordenar documentos"
          >
            <option value="data:desc">Mais recentes</option>
            <option value="data:asc">Mais antigos</option>
            <option value="titulo:asc">Título (A–Z)</option>
            <option value="titulo:desc">Título (Z–A)</option>
            <option value="origem:asc">Origem (A–Z)</option>
            <option value="empreendedor:asc">Empreendedor (A–Z)</option>
          </select>

          {hasActiveFilters && (
            <button type="button" className="btn light small" onClick={clearFilters}>
              Limpar filtros
            </button>
          )}

          <span className="badge gray" style={{ marginLeft: 'auto' }}>
            {filteredDocs.length} documento(s)
          </span>
        </div>

        {/* Estado de Carregamento */}
        {loading ? (
          <div className="empty">
            <div className="empty-icon">⏳</div>
            <b>Consultando catálogo de documentos...</b>
            <p>Verificando metadados sincronizados e disponibilidade das origens.</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          /* Estado de Lista Vazia ou Sem Resultados */
          <div className="empty">
            <div className="empty-icon">📄</div>
            <b>
              {hasActiveFilters
                ? 'Nenhum documento encontrado para os filtros informados'
                : 'Nenhum documento catalogado no momento'}
            </b>
            <p>
              {hasActiveFilters
                ? 'Ajuste os termos de busca, origem, tipo ou período para visualizar outros registros.'
                : 'Os documentos aparecerão aqui assim que a integração com Classifica, Notifica e Fiscaliza estiver conectada e sincronizada.'}
            </p>
            {hasActiveFilters && (
              <div style={{ marginTop: '12px' }}>
                <button type="button" className="btn soft small" onClick={clearFilters}>
                  Limpar filtros aplicados
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Tabela Responsiva de Documentos */
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Documento</th>
                  <th>Empreendedor / Processo</th>
                  <th>Barragem / CAR-MT</th>
                  <th>Analista(s) / RT</th>
                  <th>Emissão / Sinc.</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map(doc => {
                  const isBusy = accessingDocId === doc.id;
                  const isUnavailable = doc.situacao === 'Indisponível na origem';
                  return (
                    <tr key={doc.id}>
                      <td>
                        <span className={`badge ${ORIGEM_BADGE_CLASS[doc.origemSistema]}`}>
                          {doc.origemSistema}
                        </span>
                      </td>

                      <td style={{ whiteSpace: 'normal', minWidth: '210px', maxWidth: '280px' }}>
                        <span className="td-main" style={{ display: 'block' }}>
                          {doc.titulo}
                        </span>
                        <span className="td-sub">
                          {doc.tipoNome}
                          {doc.numero ? ` · Nº ${doc.numero}` : ''}
                        </span>
                      </td>

                      <td style={{ whiteSpace: 'normal', minWidth: '180px' }}>
                        <span style={{ fontWeight: 700, color: '#1e293b', display: 'block' }}>
                          {doc.empreendedorNome || '—'}
                        </span>
                        <span className="td-sub">
                          {doc.empreendedorCpfCnpj ? `${doc.empreendedorCpfCnpj} · ` : ''}
                          {doc.processo ? `Proc. ${doc.processo}` : 'Sem processo'}
                        </span>
                      </td>

                      <td style={{ whiteSpace: 'normal', minWidth: '160px' }}>
                        <span style={{ fontWeight: 600, color: '#334155', display: 'block' }}>
                          {doc.barragemNome || '—'}
                        </span>
                        <span className="td-sub">
                          {doc.carMt ? `CAR: ${doc.carMt}` : 'CAR não vinculado'}
                        </span>
                      </td>

                      <td style={{ whiteSpace: 'normal', minWidth: '150px' }}>
                        <span>
                          {doc.analistasElaboradores.length > 0
                            ? doc.analistasElaboradores.join(', ')
                            : '—'}
                        </span>
                        {doc.responsavelTecnicoNome && (
                          <span className="td-sub">RT: {doc.responsavelTecnicoNome}</span>
                        )}
                      </td>

                      <td>
                        <span style={{ fontWeight: 600, color: '#1e293b', display: 'block' }}>
                          {formatDateBr(doc.dataEmissao)}
                        </span>
                        <span className="td-sub" title="Última sincronização">
                          Sinc: {formatDateTimeBr(doc.sincronizadoEm)}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            isUnavailable
                              ? 'red'
                              : doc.situacao === 'Cancelado'
                              ? 'gray'
                              : 'green'
                          }`}
                        >
                          {doc.situacao}
                        </span>
                      </td>

                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="iconbtn"
                            onClick={() => setSelectedDoc(doc)}
                            title="Visualizar metadados e vínculos do documento"
                          >
                            Detalhes
                          </button>
                          <button
                            type="button"
                            className="iconbtn"
                            disabled={isBusy}
                            onClick={() => handleOpenOriginal(doc)}
                            title={`Abrir documento original no ${doc.origemSistema}`}
                          >
                            {isBusy ? '...' : 'Abrir original'}
                          </button>
                          {doc.suportaDownload !== false && (
                            <button
                              type="button"
                              className="iconbtn"
                              disabled={isBusy}
                              onClick={() => handleDownloadOriginal(doc)}
                              title={`Baixar documento original do ${doc.origemSistema}`}
                            >
                              Baixar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Detalhe do Documento (Somente Consulta) */}
      {selectedDoc && (
        <div
          className="modal-back"
          onClick={e => e.target === e.currentTarget && setSelectedDoc(null)}
        >
          <div className="modal">
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className={`badge ${ORIGEM_BADGE_CLASS[selectedDoc.origemSistema]}`}>
                  {selectedDoc.origemSistema}
                </span>
                <h3>{selectedDoc.titulo}</h3>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setSelectedDoc(null)}
                aria-label="Fechar detalhes"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="notice slate" style={{ marginBottom: '16px' }}>
                <strong>Consulta de Metadados:</strong> O arquivo original permanece armazenado no
                sistema <b>{selectedDoc.origemSistema}</b> (ID de origem:{' '}
                <code>{selectedDoc.origemDocumentoId}</code>).
              </div>

              <div className="form-grid">
                <div className="form-field">
                  <label>Tipo de Documento</label>
                  <div>{selectedDoc.tipoNome}</div>
                </div>
                <div className="form-field">
                  <label>Número do Documento</label>
                  <div>{selectedDoc.numero || '—'}</div>
                </div>
                <div className="form-field">
                  <label>Data de Emissão / Geração</label>
                  <div>{formatDateBr(selectedDoc.dataEmissao)}</div>
                </div>
                <div className="form-field">
                  <label>Situação / Última Sincronização</label>
                  <div>
                    {selectedDoc.situacao} · {formatDateTimeBr(selectedDoc.sincronizadoEm)}
                  </div>
                </div>
                <div className="form-field full">
                  <label>Analista(s) / Elaborador(es)</label>
                  <div>
                    {selectedDoc.analistasElaboradores.length > 0
                      ? selectedDoc.analistasElaboradores.join(', ')
                      : '—'}
                  </div>
                </div>
                <div className="form-field">
                  <label>Empreendedor</label>
                  <div>{selectedDoc.empreendedorNome || '—'}</div>
                </div>
                <div className="form-field">
                  <label>CPF / CNPJ</label>
                  <div>{selectedDoc.empreendedorCpfCnpj || '—'}</div>
                </div>
                <div className="form-field">
                  <label>Processo Relacionado</label>
                  <div>{selectedDoc.processo || '—'}</div>
                </div>
                <div className="form-field">
                  <label>CAR / MT</label>
                  <div>{selectedDoc.carMt || '—'}</div>
                </div>
                <div className="form-field">
                  <label>Barragem Relacionada</label>
                  <div>{selectedDoc.barragemNome || '—'}</div>
                </div>
                <div className="form-field">
                  <label>Responsável Técnico (RT)</label>
                  <div>{selectedDoc.responsavelTecnicoNome || '—'}</div>
                </div>
              </div>
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn light"
                onClick={() => setSelectedDoc(null)}
              >
                Fechar
              </button>
              <button
                type="button"
                className="btn green"
                disabled={accessingDocId === selectedDoc.id}
                onClick={() => handleOpenOriginal(selectedDoc)}
              >
                Abrir original
              </button>
              {selectedDoc.suportaDownload !== false && (
                <button
                  type="button"
                  className="btn soft"
                  disabled={accessingDocId === selectedDoc.id}
                  onClick={() => handleDownloadOriginal(selectedDoc)}
                >
                  Baixar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
