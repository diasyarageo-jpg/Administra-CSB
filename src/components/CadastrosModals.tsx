import React, { useState, useEffect } from 'react';
import {
  getUfs,
  getMunicipiosByUf,
  getMatoGrossoMunicipios,
  IbgeUf,
  IbgeMunicipio
} from '../services/ibgeService';
import {
  resolveDamEntrepreneur,
  resolveDamEmpreendimento,
  resolveDamName
} from '../App';
import { RtVinculo, cleanCpf, cleanRegistro } from '../services/notificaDataService';

// ============================================================================
// 1. MODAL DE EMPREENDEDORES E EMPREENDIMENTOS
// ============================================================================
export function EmpreendedorModal({
  record,
  isNew,
  onClose,
  onSave
}: {
  record: any;
  isNew: boolean;
  onClose: () => void;
  onSave: (savedRecord: any) => void;
}) {
  // Informações pessoais do empreendedor
  const [tipoPessoa, setTipoPessoa] = useState<string>(record.tipoPessoa || 'Pessoa jurídica');
  const [nome, setNome] = useState<string>(record.nome || '');
  const [cpfCnpj, setCpfCnpj] = useState<string>(record.cpfCnpj || '');
  const [nomeFantasia, setNomeFantasia] = useState<string>(record.nomeFantasia || '');
  const [email, setEmail] = useState<string>(record.email || '');
  const [telefone, setTelefone] = useState<string>(record.telefone || '');
  const [uf, setUf] = useState<string>(record.uf || (record.municipio ? 'MT' : ''));
  const [municipio, setMunicipio] = useState<string>(record.municipio || '');
  const [municipioIbge, setMunicipioIbge] = useState<string>(record.municipioIbge || '');
  const [observacoes, setObservacoes] = useState<string>(record.observacoes || '');
  const [situacao, setSituacao] = useState<string>(record.situacao || 'Ativo');

  // Informações do empreendimento (múltiplos permitidos)
  const [empreendimentos, setEmpreendimentos] = useState<any[]>(
    Array.isArray(record.empreendimentos) ? [...record.empreendimentos] : []
  );

  // Sub-formulário para adicionar novo empreendimento
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoTipo, setNovoTipo] = useState<'Rural' | 'Urbano'>('Rural');
  const [novoCar, setNovoCar] = useState<string>('');
  const [novoEscritura, setNovoEscritura] = useState<string>('');
  const [novoUf, setNovoUf] = useState<string>(uf || 'MT');
  const [novoMun, setNovoMun] = useState<string>('');
  const [novoMunIbge, setNovoMunIbge] = useState<string>('');

  // IBGE State
  const [ufs, setUfs] = useState<IbgeUf[]>([]);
  const [municipios, setMunicipios] = useState<IbgeMunicipio[]>([]);
  const [novoMunicipios, setNovoMunicipios] = useState<IbgeMunicipio[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Carrega UFs do IBGE
  useEffect(() => {
    getUfs().then(list => setUfs(list)).catch(() => {});
  }, []);

  // Carrega municípios da UF do empreendedor
  useEffect(() => {
    if (uf) {
      getMunicipiosByUf(uf).then(list => {
        setMunicipios(list);
        if (municipio && !municipioIbge) {
          const match = list.find(m => m.nome.toLowerCase() === municipio.toLowerCase());
          if (match) setMunicipioIbge(String(match.id));
        }
      }).catch(() => {});
    } else {
      setMunicipios([]);
    }
  }, [uf]);

  // Carrega municípios da UF do novo empreendimento
  useEffect(() => {
    if (novoUf) {
      getMunicipiosByUf(novoUf).then(list => setNovoMunicipios(list)).catch(() => {});
    } else {
      setNovoMunicipios([]);
    }
  }, [novoUf]);

  const handleAddEmpreendimento = () => {
    setErrorMsg(null);
    if (!novoNome.trim()) {
      setErrorMsg('Informe o nome ou denominação do empreendimento.');
      return;
    }
    if (novoTipo === 'Rural' && !novoCar.trim()) {
      setErrorMsg('Para empreendimento rural, informe o número do CAR.');
      return;
    }
    if (novoTipo === 'Urbano' && !novoEscritura.trim()) {
      setErrorMsg('Para empreendimento urbano, informe o número da escritura.');
      return;
    }

    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `emp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      nome: novoNome.trim(),
      tipo: novoTipo,
      car: novoTipo === 'Rural' ? novoCar.trim() : '',
      escritura: novoTipo === 'Urbano' ? novoEscritura.trim() : '',
      uf: novoUf || uf || 'MT',
      municipio: novoMun || municipio || '',
      municipioIbge: novoMunIbge || municipioIbge || '',
      createdAt: new Date().toISOString()
    };

    setEmpreendimentos(prev => [...prev, item]);
    setNovoNome('');
    setNovoCar('');
    setNovoEscritura('');
  };

  const handleRemoveEmpreendimento = (id: string) => {
    setEmpreendimentos(prev => prev.filter(item => item.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      alert('Informe o Nome / Razão social do empreendedor.');
      return;
    }
    if (!cpfCnpj.trim()) {
      alert('Informe o CPF/CNPJ do empreendedor.');
      return;
    }

    onSave({
      ...record,
      tipoPessoa,
      nome: nome.trim(),
      cpfCnpj: cpfCnpj.trim(),
      nomeFantasia: nomeFantasia.trim(),
      email: email.trim(),
      telefone: telefone.trim(),
      uf: uf.trim(),
      municipio: municipio.trim(),
      municipioIbge: String(municipioIbge || '').trim(),
      observacoes: observacoes.trim(),
      situacao,
      empreendimentos
    });
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={handleSubmit} style={{ width: 'min(780px, 100%)' }}>
        <div className="modal-head">
          <h3>{isNew ? 'Novo cadastro' : 'Editar cadastro'} · Empreendedor</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          {/* SEÇÃO 1: INFORMAÇÕES PESSOAIS DO EMPREENDEDOR */}
          <div style={{ marginBottom: '22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <span className="badge green">1</span>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>Informações pessoais do empreendedor</strong>
            </div>

            <div className="form-grid">
              <div className="form-field">
                <label>Tipo de pessoa · obrigatório</label>
                <select className="select" value={tipoPessoa} onChange={e => setTipoPessoa(e.target.value)}>
                  <option value="Pessoa física">Pessoa física</option>
                  <option value="Pessoa jurídica">Pessoa jurídica</option>
                </select>
              </div>

              <div className="form-field">
                <label>Nome / Razão social · obrigatório</label>
                <input
                  className="input"
                  required
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Nome completo ou razão social"
                />
              </div>

              <div className="form-field">
                <label>CPF/CNPJ · obrigatório</label>
                <input
                  className="input"
                  required
                  value={cpfCnpj}
                  onChange={e => setCpfCnpj(e.target.value)}
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                />
              </div>

              <div className="form-field">
                <label>Nome fantasia</label>
                <input
                  className="input"
                  value={nomeFantasia}
                  onChange={e => setNomeFantasia(e.target.value)}
                  placeholder="Nome fantasia (se houver)"
                />
              </div>

              <div className="form-field">
                <label>E-mail</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="contato@empresa.com"
                />
              </div>

              <div className="form-field">
                <label>Telefone</label>
                <input
                  className="input"
                  value={telefone}
                  onChange={e => setTelefone(e.target.value)}
                  placeholder="(65) 99999-9999"
                />
              </div>

              {/* UF e Município via API oficial do IBGE */}
              <div className="form-field">
                <label>UF de referência (IBGE)</label>
                <select
                  className="select"
                  value={uf}
                  onChange={e => {
                    const newUf = e.target.value;
                    setUf(newUf);
                    setMunicipio('');
                    setMunicipioIbge('');
                  }}
                >
                  <option value="">Selecione a UF...</option>
                  {ufs.map(u => (
                    <option key={u.id} value={u.sigla}>
                      {u.sigla} — {u.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Município de referência (IBGE)</label>
                <select
                  className="select"
                  value={municipio}
                  disabled={!uf && !municipio}
                  onChange={e => {
                    const munNome = e.target.value;
                    setMunicipio(munNome);
                    const selected = municipios.find(m => m.nome === munNome);
                    if (selected) {
                      setMunicipioIbge(String(selected.id));
                    }
                  }}
                >
                  <option value="">{uf ? 'Selecione o município...' : 'Selecione primeiro a UF'}</option>
                  {municipios.map(m => (
                    <option key={m.id} value={m.nome}>
                      {m.nome} ({m.id})
                    </option>
                  ))}
                  {/* Preserva município legado se não constar na lista da API */}
                  {municipio && !municipios.some(m => m.nome.toLowerCase() === municipio.toLowerCase()) && (
                    <option value={municipio}>{municipio} (Texto original mantido)</option>
                  )}
                </select>
                {municipioIbge && (
                  <span style={{ fontSize: '10px', color: '#059669', marginTop: '2px' }}>
                    Código IBGE: <b>{municipioIbge}</b>
                  </span>
                )}
              </div>

              <div className="form-field full">
                <label>Observações</label>
                <textarea
                  className="textarea"
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Informações adicionais do empreendedor"
                />
              </div>
            </div>
          </div>

          {/* SEÇÃO 2: INFORMAÇÕES DO EMPREENDIMENTO */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge blue">2</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>Informações do empreendimento</strong>
              </div>
              <span className="badge gray">{empreendimentos.length} cadastrado(s)</span>
            </div>

            <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 14px' }}>
              Permite cadastrar mais de um empreendimento para o mesmo empreendedor. Empreendimentos rurais exigem o número do CAR; empreendimentos urbanos exigem o número da escritura.
            </p>

            {/* Lista de empreendimentos cadastrados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {empreendimentos.length > 0 ? (
                empreendimentos.map((em, idx) => (
                  <div
                    key={em.id || idx}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      background: '#f8fafc',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span className={`badge ${em.tipo === 'Rural' ? 'green' : 'blue'}`}>
                          {em.tipo}
                        </span>
                        <strong style={{ fontSize: '13px', color: '#1e293b' }}>{em.nome}</strong>
                      </div>
                      <div style={{ fontSize: '11px', color: '#475569', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        {em.tipo === 'Rural' && (
                          <span><b>CAR:</b> {em.car || '—'}</span>
                        )}
                        {em.tipo === 'Urbano' && (
                          <span><b>Escritura:</b> {em.escritura || '—'}</span>
                        )}
                        {em.municipio && (
                          <span><b>Localidade:</b> {em.municipio}{em.uf ? `/${em.uf}` : ''} {em.municipioIbge ? `(${em.municipioIbge})` : ''}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="iconbtn"
                      style={{ color: '#e11d48', borderColor: '#fecdd3' }}
                      onClick={() => handleRemoveEmpreendimento(em.id)}
                      title="Remover empreendimento"
                    >
                      Remover
                    </button>
                  </div>
                ))
              ) : (
                <div className="notice slate" style={{ textAlign: 'center' }}>
                  Nenhum empreendimento cadastrado para este empreendedor. Utilize o formulário abaixo para adicionar.
                </div>
              )}
            </div>

            {/* Sub-formulário para adicionar empreendimento */}
            <div style={{ border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '14px', background: '#ffffff' }}>
              <strong style={{ fontSize: '12px', color: '#0f172a', display: 'block', marginBottom: '10px' }}>
                ＋ Adicionar novo empreendimento
              </strong>

              {errorMsg && (
                <div className="notice amber" style={{ marginBottom: '10px' }}>
                  {errorMsg}
                </div>
              )}

              <div className="form-grid">
                <div className="form-field">
                  <label>Nome / Denominação do empreendimento · obrigatório</label>
                  <input
                    className="input"
                    value={novoNome}
                    onChange={e => setNovoNome(e.target.value)}
                    placeholder="Ex: Fazenda Santa Maria ou Loteamento Solar"
                  />
                </div>

                <div className="form-field">
                  <label>Tipo de empreendimento · obrigatório</label>
                  <select
                    className="select"
                    value={novoTipo}
                    onChange={e => setNovoTipo(e.target.value as 'Rural' | 'Urbano')}
                  >
                    <option value="Rural">Rural (exige CAR)</option>
                    <option value="Urbano">Urbano (exige Escritura)</option>
                  </select>
                </div>

                {novoTipo === 'Rural' ? (
                  <div className="form-field full">
                    <label>Número do CAR · obrigatório para rural</label>
                    <input
                      className="input"
                      value={novoCar}
                      onChange={e => setNovoCar(e.target.value)}
                      placeholder="MT-0000000-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    />
                  </div>
                ) : (
                  <div className="form-field full">
                    <label>Número da escritura · obrigatório para urbano</label>
                    <input
                      className="input"
                      value={novoEscritura}
                      onChange={e => setNovoEscritura(e.target.value)}
                      placeholder="Número da matrícula ou escritura pública"
                    />
                  </div>
                )}

                <div className="form-field">
                  <label>UF do empreendimento (IBGE)</label>
                  <select
                    className="select"
                    value={novoUf}
                    onChange={e => {
                      setNovoUf(e.target.value);
                      setNovoMun('');
                      setNovoMunIbge('');
                    }}
                  >
                    {ufs.map(u => (
                      <option key={u.id} value={u.sigla}>
                        {u.sigla} — {u.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Município do empreendimento (IBGE)</label>
                  <select
                    className="select"
                    value={novoMun}
                    onChange={e => {
                      const mName = e.target.value;
                      setNovoMun(mName);
                      const mObj = novoMunicipios.find(m => m.nome === mName);
                      if (mObj) setNovoMunIbge(String(mObj.id));
                    }}
                  >
                    <option value="">Selecione o município...</option>
                    {novoMunicipios.map(m => (
                      <option key={m.id} value={m.nome}>
                        {m.nome} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: '12px', textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn soft small"
                  style={{ background: '#0f172a', color: '#fff' }}
                  onClick={handleAddEmpreendimento}
                >
                  ＋ Adicionar este empreendimento
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn green">Salvar cadastro</button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// 2. MODAL DE BARRAGENS
// ============================================================================
export function BarragemModal({
  record,
  isNew,
  empreendedores,
  onClose,
  onSave
}: {
  record: any;
  isNew: boolean;
  empreendedores: any[];
  onClose: () => void;
  onSave: (savedRecord: any) => void;
}) {
  const [nome, setNome] = useState<string>(record.nome || '');
  const [car, setCar] = useState<string>(record.car || '');
  const [municipio, setMunicipio] = useState<string>(record.municipio || '');
  const [municipioIbge, setMunicipioIbge] = useState<string>(record.municipioIbge || '');
  const [processo, setProcesso] = useState<string>(record.processo || '');
  const [snisb, setSnisb] = useState<string>(record.snisb || '');
  const [cursoAgua, setCursoAgua] = useState<string>(record.cursoAgua || '');
  const [latitude, setLatitude] = useState<string>(record.latitude || '');
  const [longitude, setLongitude] = useState<string>(record.longitude || '');
  const [situacao, setSituacao] = useState<string>(record.situacao || 'Aguardando confirmação');
  const [observacoes, setObservacoes] = useState<string>(record.observacoes || '');

  // Vínculo com Empreendedor
  const initialResolvedEmp = resolveDamEntrepreneur(record.empreendedor, empreendedores);
  const [selectedEmpId, setSelectedEmpId] = useState<string>(
    initialResolvedEmp.id || (record.empreendedor ? String(record.empreendedor) : '')
  );

  // Vínculo com Empreendimento pertencente ao empreendedor selecionado
  const [selectedEmpreendimentoId, setSelectedEmpreendimentoId] = useState<string>(
    record.empreendimento ? String(record.empreendimento) : ''
  );

  // Municípios de MT via API do IBGE (UF 51)
  const [mtMunicipios, setMtMunicipios] = useState<IbgeMunicipio[]>([]);

  useEffect(() => {
    getMatoGrossoMunicipios().then(list => {
      setMtMunicipios(list);
      if (municipio && !municipioIbge) {
        const found = list.find(m => m.nome.toLowerCase() === municipio.toLowerCase());
        if (found) setMunicipioIbge(String(found.id));
      }
    }).catch(() => {});
  }, []);

  // Empreendedores ativos e preservação de inativo/legado (em ordem alfabética)
  const activeEmps = empreendedores
    .filter(e => e.situacao === 'Ativo')
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }));
  const linkedEmp = selectedEmpId ? empreendedores.find(e => String(e.id) === String(selectedEmpId)) : null;
  const isLinkedInactive = linkedEmp && linkedEmp.situacao !== 'Ativo';
  const isUnmatchedLegacyEmp = !linkedEmp && Boolean(record.empreendedor && String(record.empreendedor).trim());

  // Lista de empreendimentos pertencentes ao empreendedor selecionado
  const availableEmpreendimentos: any[] = Array.isArray(linkedEmp?.empreendimentos)
    ? linkedEmp.empreendimentos
    : [];

  // Preserva empreendimento legado se não corresponder aos novos
  const linkedEmpreendimento = availableEmpreendimentos.find(
    em => String(em.id) === String(selectedEmpreendimentoId)
  );
  const isUnmatchedLegacyEmpreendimento =
    !linkedEmpreendimento && Boolean(selectedEmpreendimentoId && String(selectedEmpreendimentoId).trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      alert('Informe o nome / identificação da barragem.');
      return;
    }

    onSave({
      ...record,
      nome: nome.trim(),
      car: car.trim(),
      uf: 'MT',
      municipio: municipio.trim(),
      municipioIbge: String(municipioIbge || '').trim(),
      empreendedor: selectedEmpId.trim(),
      empreendimento: selectedEmpreendimentoId.trim(),
      processo: processo.trim(),
      snisb: snisb.trim(),
      cursoAgua: cursoAgua.trim(),
      latitude: latitude.trim(),
      longitude: longitude.trim(),
      situacao,
      observacoes: observacoes.trim()
    });
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={handleSubmit} style={{ width: 'min(740px, 100%)' }}>
        <div className="modal-head">
          <h3>{isNew ? 'Novo cadastro' : 'Editar cadastro'} · Barragem</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          <div className="form-grid">
            <div className="form-field full">
              <label>Identificação / nome da barragem · obrigatório</label>
              <input
                className="input"
                required
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: Barragem PCH Santa Rosa"
              />
            </div>

            <div className="form-field">
              <label>CAR/MT</label>
              <input
                className="input"
                value={car}
                onChange={e => setCar(e.target.value)}
                placeholder="Número do CAR no Estado de Mato Grosso"
              />
            </div>

            {/* Municípios de Mato Grosso (UF 51) via IBGE */}
            <div className="form-field">
              <label>Município (Mato Grosso · UF 51)</label>
              <select
                className="select"
                value={municipio}
                onChange={e => {
                  const mName = e.target.value;
                  setMunicipio(mName);
                  const found = mtMunicipios.find(m => m.nome === mName);
                  if (found) setMunicipioIbge(String(found.id));
                }}
              >
                <option value="">Selecione o município de MT...</option>
                {mtMunicipios.map(m => (
                  <option key={m.id} value={m.nome}>
                    {m.nome} ({m.id})
                  </option>
                ))}
                {/* Preserva município legado se não constar na lista oficial */}
                {municipio && !mtMunicipios.some(m => m.nome.toLowerCase() === municipio.toLowerCase()) && (
                  <option value={municipio}>{municipio} (Texto original mantido)</option>
                )}
              </select>
              {municipioIbge && (
                <span style={{ fontSize: '10px', color: '#059669', marginTop: '2px' }}>
                  Código IBGE: <b>{municipioIbge}</b> (Mato Grosso)
                </span>
              )}
            </div>

            {/* Vínculo com Empreendedor */}
            <div className="form-field full">
              <label>Empreendedor vinculado</label>
              <select
                className="select"
                value={selectedEmpId}
                onChange={e => {
                  const newEmpId = e.target.value;
                  setSelectedEmpId(newEmpId);
                  // Reseta empreendimento ao trocar de empreendedor
                  setSelectedEmpreendimentoId('');
                }}
              >
                <option value="">Selecione o empreendedor...</option>
                {activeEmps.map(emp => {
                  const label = emp.nome
                    ? `${emp.nome}${emp.nomeFantasia ? ` (${emp.nomeFantasia})` : ''}`
                    : (emp.nomeFantasia || emp.cpfCnpj || emp.id);
                  return (
                    <option key={emp.id} value={emp.id}>
                      {label}
                    </option>
                  );
                })}
                {/* Preserva vínculo existente com empreendedor inativo */}
                {isLinkedInactive && (() => {
                  const label = linkedEmp.nome
                    ? `${linkedEmp.nome}${linkedEmp.nomeFantasia ? ` (${linkedEmp.nomeFantasia})` : ''}`
                    : (linkedEmp.nomeFantasia || linkedEmp.cpfCnpj || linkedEmp.id);
                  const statusLabel = linkedEmp.situacao === 'Inativo' ? ' (Inativo)' : ` (${linkedEmp.situacao || 'Inativo'})`;
                  return (
                    <option key={linkedEmp.id} value={linkedEmp.id}>
                      {label}{statusLabel}
                    </option>
                  );
                })()}
                {/* Preserva texto legado sem correspondência única */}
                {isUnmatchedLegacyEmp && (
                  <option key="legacy-emp" value={record.empreendedor}>
                    {record.empreendedor} (Texto original mantido)
                  </option>
                )}
              </select>
            </div>

            {/* Vínculo com Empreendimento pertencente ao empreendedor selecionado */}
            <div className="form-field full">
              <label>Empreendimento vinculado</label>
              <select
                className="select"
                value={selectedEmpreendimentoId}
                disabled={!selectedEmpId}
                onChange={e => setSelectedEmpreendimentoId(e.target.value)}
              >
                <option value="">
                  {selectedEmpId ? 'Selecione o empreendimento deste empreendedor...' : 'Selecione primeiro o empreendedor'}
                </option>
                {availableEmpreendimentos.map(em => {
                  const doc = em.tipo === 'Rural'
                    ? (em.car ? ` · CAR: ${em.car}` : '')
                    : (em.escritura ? ` · Escritura: ${em.escritura}` : '');
                  return (
                    <option key={em.id} value={em.id}>
                      {em.nome} ({em.tipo}{doc})
                    </option>
                  );
                })}
                {/* Preserva empreendimento legado se existente */}
                {isUnmatchedLegacyEmpreendimento && (
                  <option key="legacy-empreendimento" value={selectedEmpreendimentoId}>
                    {selectedEmpreendimentoId} (Texto original mantido)
                  </option>
                )}
              </select>

              {selectedEmpId && availableEmpreendimentos.length === 0 && (
                <small style={{ color: '#d97706', marginTop: '4px' }}>
                  Este empreendedor ainda não possui empreendimentos cadastrados. Cadastre um empreendimento no módulo de Empreendedores.
                </small>
              )}
            </div>

            <div className="form-field">
              <label>Número do processo</label>
              <input
                className="input"
                value={processo}
                onChange={e => setProcesso(e.target.value)}
                placeholder="Ex: 12345/2026"
              />
            </div>

            <div className="form-field">
              <label>Identificador SNISB</label>
              <input
                className="input"
                value={snisb}
                onChange={e => setSnisb(e.target.value)}
                placeholder="Código oficial SNISB"
              />
            </div>

            <div className="form-field">
              <label>Curso d’água</label>
              <input
                className="input"
                value={cursoAgua}
                onChange={e => setCursoAgua(e.target.value)}
                placeholder="Rio ou córrego barreado"
              />
            </div>

            <div className="form-field">
              <label>Situação cadastral</label>
              <select className="select" value={situacao} onChange={e => setSituacao(e.target.value)}>
                <option value="Ativa">Ativa</option>
                <option value="Inativa">Inativa</option>
                <option value="Aguardando confirmação">Aguardando confirmação</option>
              </select>
            </div>

            <div className="form-field">
              <label>Latitude</label>
              <input
                className="input"
                value={latitude}
                onChange={e => setLatitude(e.target.value)}
                placeholder="-15.5960 ou 15°35'45''S"
              />
            </div>

            <div className="form-field">
              <label>Longitude</label>
              <input
                className="input"
                value={longitude}
                onChange={e => setLongitude(e.target.value)}
                placeholder="-56.0969 ou 56°05'48''W"
              />
            </div>

            <div className="form-field full">
              <label>Observações</label>
              <textarea
                className="textarea"
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                placeholder="Observações técnicas ou administrativas da barragem"
              />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn green">Salvar cadastro</button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// 3. MODAL DE RESPONSÁVEIS TÉCNICOS E VÍNCULOS DE ART/BARRAGENS
// Ficha única por profissional centralizando múltiplos pares de ART + Barragem
// ============================================================================
export function RtModal({
  record,
  isNew,
  barragens,
  existingRts = [],
  onClose,
  onSave
}: {
  record: any;
  isNew: boolean;
  barragens: any[];
  existingRts?: any[];
  onClose: () => void;
  onSave: (savedRecord: any) => void;
}) {
  // Dados do Profissional
  const [nome, setNome] = useState<string>(record.nome || '');
  const [cpf, setCpf] = useState<string>(record.cpf || '');
  const [conselho, setConselho] = useState<string>(record.conselho || 'CREA-MT');
  const [ufConselho, setUfConselho] = useState<string>(record.ufConselho || 'MT');
  const [registro, setRegistro] = useState<string>(record.registro || '');
  const [especialidades, setEspecialidades] = useState<string>(record.especialidades || '');
  const [email, setEmail] = useState<string>(record.email || '');
  const [telefone, setTelefone] = useState<string>(record.telefone || '');
  const [situacao, setSituacao] = useState<string>(record.situacao || 'Ativo');
  const [observacoes, setObservacoes] = useState<string>(record.observacoes || '');

  // Vínculos de ART/RRT e Barragens pertencentes a este profissional
  const [vinculos, setVinculos] = useState<RtVinculo[]>(() => {
    if (Array.isArray(record.vinculos) && record.vinculos.length > 0) {
      return [...record.vinculos];
    }
    // Caso seja registro antigo com ART direta
    if (record.art || record.artRrt || record.barragemVinculada) {
      return [
        {
          id: String(record.id || `vinc_${Date.now()}`),
          art: String(record.art || record.artRrt || '').trim(),
          artRrt: String(record.artRrt || record.art || '').trim(),
          barragemVinculada: String(record.barragemVinculada || '').trim(),
          barragemId: record.barragemId || record.barragemVinculada,
          nomeBarragem: record.nomeBarragem,
          validade: record.validade || '',
          situacao: record.situacao || 'Ativo',
          observacoes: record.observacoes || ''
        }
      ];
    }
    return [];
  });

  // Rastreamento de vínculos excluídos para remoção sincronizada no banco
  const [removedLinkIds, setRemovedLinkIds] = useState<string[]>([]);

  // Sub-formulário para inclusão / edição de vínculo de ART
  const [vincArt, setVincArt] = useState('');
  const [vincBarragem, setVincBarragem] = useState('');
  const [vincValidade, setVincValidade] = useState('');
  const [vincSituacao, setVincSituacao] = useState('Ativo');
  const [vincObs, setVincObs] = useState('');
  const [editingVincIndex, setEditingVincIndex] = useState<number | null>(null);

  // Verificação de duplicidade institucional em tempo real (por CPF ou Registro)
  const cleanInputCpf = cleanCpf(cpf);
  const cleanInputReg = cleanRegistro(registro);

  const duplicateMatch = existingRts.find(other => {
    if (other.id === record.id) return false;
    const oCpf = cleanCpf(other.cpf);
    const oReg = cleanRegistro(other.registro);
    const oCons = String(other.conselho || '').trim().toUpperCase();
    const currCons = String(conselho || '').trim().toUpperCase();

    if (cleanInputCpf && cleanInputCpf.length === 11 && oCpf === cleanInputCpf) {
      return true;
    }
    if (cleanInputReg && cleanInputReg.length >= 3 && oReg === cleanInputReg && oCons === currCons) {
      return true;
    }
    return false;
  });

  const handleAddOrUpdateVinculo = () => {
    if (!vincArt.trim()) {
      alert('Informe o número da ART/RRT para este vínculo.');
      return;
    }
    if (!vincBarragem.trim()) {
      alert('Selecione a barragem vinculada à ART/RRT.');
      return;
    }

    const damObj = barragens.find(b => String(b.id) === vincBarragem.trim() || String(b.nome).toLowerCase() === vincBarragem.toLowerCase().trim());
    const damName = damObj ? damObj.nome : undefined;

    if (editingVincIndex !== null && editingVincIndex >= 0 && editingVincIndex < vinculos.length) {
      // Atualiza vínculo existente
      const updated = [...vinculos];
      updated[editingVincIndex] = {
        ...updated[editingVincIndex],
        art: vincArt.trim(),
        artRrt: vincArt.trim(),
        barragemVinculada: vincBarragem.trim(),
        barragemId: vincBarragem.trim(),
        nomeBarragem: damName || updated[editingVincIndex].nomeBarragem,
        validade: vincValidade || undefined,
        situacao: vincSituacao,
        observacoes: vincObs.trim() || undefined
      };
      setVinculos(updated);
      setEditingVincIndex(null);
    } else {
      // Adiciona novo vínculo
      const newVinc: RtVinculo = {
        id: `vinc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        art: vincArt.trim(),
        artRrt: vincArt.trim(),
        barragemVinculada: vincBarragem.trim(),
        barragemId: vincBarragem.trim(),
        nomeBarragem: damName,
        validade: vincValidade || undefined,
        situacao: vincSituacao,
        observacoes: vincObs.trim() || undefined,
        originTable: 'responsaveis_tecnicos_barragens'
      };
      setVinculos(prev => [...prev, newVinc]);
    }

    // Limpa campos do subformulário
    setVincArt('');
    setVincBarragem('');
    setVincValidade('');
    setVincSituacao('Ativo');
    setVincObs('');
  };

  const handleEditVinculo = (index: number) => {
    const item = vinculos[index];
    if (!item) return;
    setVincArt(item.art || item.artRrt || '');
    setVincBarragem(item.barragemVinculada || item.barragemId || '');
    setVincValidade(item.validade || '');
    setVincSituacao(item.situacao || 'Ativo');
    setVincObs(item.observacoes || '');
    setEditingVincIndex(index);
  };

  const handleRemoveVinculo = (index: number) => {
    const item = vinculos[index];
    if (!item) return;
    if (item.id && !item.id.startsWith('vinc_')) {
      setRemovedLinkIds(prev => [...prev, item.id]);
    }
    setVinculos(prev => prev.filter((_, idx) => idx !== index));
    if (editingVincIndex === index) {
      setEditingVincIndex(null);
      setVincArt('');
      setVincBarragem('');
      setVincValidade('');
      setVincObs('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      alert('Informe o nome do responsável técnico.');
      return;
    }

    if (vinculos.length === 0) {
      if (!confirm('Esta ficha não possui nenhum vínculo de ART ou Barragem cadastrado. Deseja salvar mesmo assim?')) {
        return;
      }
    }

    const hasReliableId = Boolean((cleanInputCpf && cleanInputCpf.length === 11) || (cleanInputReg && cleanInputReg.length >= 3));

    onSave({
      ...record,
      nome: nome.trim(),
      cpf: cpf.trim() || undefined,
      conselho: conselho.trim() || undefined,
      ufConselho: ufConselho.trim() || undefined,
      registro: registro.trim() || undefined,
      especialidades: especialidades.trim() || undefined,
      email: email.trim() || undefined,
      telefone: telefone.trim() || undefined,
      situacao,
      observacoes: observacoes.trim() || undefined,
      vinculos,
      removedLinkIds,
      // Campos de compatibilidade para buscas imediatas
      art: vinculos[0]?.art || '',
      artRrt: vinculos[0]?.artRrt || '',
      barragemVinculada: vinculos[0]?.barragemVinculada || '',
      barragensVinculadas: vinculos.map(v => v.barragemVinculada),
      nomeBarragem: vinculos[0]?.nomeBarragem,
      hasReliableIdentifier: hasReliableId,
      requiresReview: !hasReliableId,
      reviewReason: !hasReliableId
        ? 'Registro sem identificador único confiável (CPF ou Registro ausente).'
        : undefined
    });
  };

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={handleSubmit} style={{ width: 'min(860px, 100%)' }}>
        <div className="modal-head">
          <div>
            <h3>{isNew ? 'Novo cadastro' : 'Ficha do Responsável Técnico'}</h3>
            <p className="micro muted" style={{ margin: '2px 0 0' }}>
              Cadastro único por profissional · Centraliza todas as ARTs e barragens vinculadas.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          {/* Alerta de Duplicidade Institucional */}
          {duplicateMatch && (
            <div
              style={{
                marginBottom: '14px',
                padding: '12px 14px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                color: '#92400e',
                fontSize: '12px'
              }}
            >
              <strong>⚠️ Atenção à duplicidade cadastral:</strong> Já existe um profissional cadastrado com este{' '}
              {cleanInputCpf === cleanCpf(duplicateMatch.cpf) ? 'CPF' : 'Registro'} ({duplicateMatch.nome}) reunindo{' '}
              {duplicateMatch.vinculos?.length || 0} vínculo(s) de ART. Para manter uma única ficha por profissional,
              recomenda-se adicionar novos vínculos diretamente à ficha existente.
            </div>
          )}

          {/* Alerta de Registro Sinalizado para Revisão */}
          {record.requiresReview && (
            <div
              style={{
                marginBottom: '14px',
                padding: '10px 14px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                color: '#1e40af',
                fontSize: '12px'
              }}
            >
              ℹ️ <b>Registro pendente de conferência:</b> Este cadastro foi importado sem identificador único (CPF ou Registro ausente).
              Preencha o CPF ou Registro para consolidar a ficha institucional e remover o alerta de revisão.
            </div>
          )}

          {/* SEÇÃO 1: DADOS DO PROFISSIONAL */}
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#047857', marginBottom: '10px' }}>
              1. Identificação do Profissional
            </h4>
            <div className="form-grid">
              <div className="form-field full">
                <label>Nome completo · obrigatório</label>
                <input
                  className="input"
                  required
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Nome completo do engenheiro / geólogo / técnico"
                />
              </div>

              <div className="form-field">
                <label>CPF (identificador único)</label>
                <input
                  className="input"
                  value={cpf}
                  onChange={e => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                />
              </div>

              <div className="form-field">
                <label>Conselho profissional</label>
                <input
                  className="input"
                  value={conselho}
                  onChange={e => setConselho(e.target.value)}
                  placeholder="Ex: CREA-MT, CAU, CRQ"
                />
              </div>

              <div className="form-field">
                <label>UF do conselho</label>
                <input
                  className="input"
                  value={ufConselho}
                  onChange={e => setUfConselho(e.target.value)}
                  placeholder="MT"
                />
              </div>

              <div className="form-field">
                <label>Número de registro profissional</label>
                <input
                  className="input"
                  value={registro}
                  onChange={e => setRegistro(e.target.value)}
                  placeholder="Ex: 12345/D"
                />
              </div>

              <div className="form-field">
                <label>Especialidades</label>
                <input
                  className="input"
                  value={especialidades}
                  onChange={e => setEspecialidades(e.target.value)}
                  placeholder="Engenharia Civil, Geotecnia, Segurança de Barragens"
                />
              </div>

              <div className="form-field">
                <label>E-mail de contato</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="profissional@email.com"
                />
              </div>

              <div className="form-field">
                <label>Telefone</label>
                <input
                  className="input"
                  value={telefone}
                  onChange={e => setTelefone(e.target.value)}
                  placeholder="(65) 99999-9999"
                />
              </div>

              <div className="form-field">
                <label>Situação cadastral</label>
                <select className="select" value={situacao} onChange={e => setSituacao(e.target.value)}>
                  <option value="Ativo">Ativo</option>
                  <option value="Inativo">Inativo</option>
                  <option value="Aguardando confirmação">Aguardando confirmação</option>
                </select>
              </div>

              <div className="form-field full">
                <label>Observações gerais do profissional</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: '52px' }}
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Anotações institucionais sobre o RT"
                />
              </div>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

          {/* SEÇÃO 2: VÍNCULOS DE ART/RRT E BARRAGENS (MÚLTIPLOS) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#047857', margin: 0 }}>
                  2. Vínculos de ART/RRT e Barragens Vinculadas ({vinculos.length})
                </h4>
                <p className="micro muted" style={{ margin: '2px 0 0' }}>
                  Cada vínculo associa formalmente uma ART/RRT deste profissional a uma barragem.
                </p>
              </div>
            </div>

            {/* Lista dos vínculos atuais */}
            {vinculos.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {vinculos.map((vinc, idx) => {
                  const damName = resolveDamName(vinc.barragemVinculada, barragens, vinc.nomeBarragem);
                  const isEditingThis = editingVincIndex === idx;

                  return (
                    <div
                      key={vinc.id || idx}
                      style={{
                        padding: '10px 14px',
                        background: isEditingThis ? '#f0fdf4' : '#f8fafc',
                        border: isEditingThis ? '1px solid #86efac' : '1px solid #e2e8f0',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: '#047857',
                              color: 'white',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700
                            }}
                          >
                            ART: {vinc.art || vinc.artRrt || 'S/N'}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>
                            ➔ {damName}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '10px' }}>
                          <span>Validade: <b>{vinc.validade || 'Não informada'}</b></span>
                          <span>Situação: <b>{vinc.situacao || 'Ativo'}</b></span>
                          {vinc.observacoes && <span>Obs: {vinc.observacoes}</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="btn soft small"
                          style={{ padding: '3px 8px', fontSize: '11px' }}
                          onClick={() => handleEditVinculo(idx)}
                        >
                          {isEditingThis ? 'Editando...' : 'Editar'}
                        </button>
                        <button
                          type="button"
                          className="btn soft small"
                          style={{ padding: '3px 8px', fontSize: '11px', color: '#dc2626' }}
                          onClick={() => handleRemoveVinculo(idx)}
                          title="Remover este vínculo de ART"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: '16px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '12px',
                  marginBottom: '16px'
                }}
              >
                Nenhum vínculo de ART cadastrado nesta ficha. Adicione abaixo os pares de ART/RRT e Barragem vinculada.
              </div>
            )}

            {/* Painel de inclusão / edição de vínculo */}
            <div
              style={{
                padding: '14px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px'
              }}
            >
              <strong style={{ fontSize: '12px', color: '#166534', display: 'block', marginBottom: '8px' }}>
                {editingVincIndex !== null ? '✏️ Alterar dados do vínculo selecionado' : '＋ Adicionar novo vínculo de ART / Barragem'}
              </strong>

              <div className="form-grid" style={{ gap: '10px' }}>
                <div className="form-field">
                  <label style={{ fontSize: '11px' }}>Número da ART/RRT · obrigatório</label>
                  <input
                    className="input"
                    value={vincArt}
                    onChange={e => setVincArt(e.target.value)}
                    placeholder="Ex: 20260123456"
                  />
                </div>

                <div className="form-field">
                  <label style={{ fontSize: '11px' }}>Barragem vinculada · obrigatório</label>
                  <select
                    className="select"
                    value={vincBarragem}
                    onChange={e => setVincBarragem(e.target.value)}
                  >
                    <option value="">Selecione a estrutura...</option>
                    {barragens
                      .slice()
                      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }))
                      .map(b => (
                        <option key={b.id} value={b.id}>
                          {b.nome}{b.municipio ? ` — ${b.municipio}` : ''}
                        </option>
                      ))}
                    {vincBarragem && !barragens.some(b => String(b.id) === vincBarragem) && (
                      <option value={vincBarragem}>
                        {vincBarragem} (Identificação mantida)
                      </option>
                    )}
                  </select>
                </div>

                <div className="form-field">
                  <label style={{ fontSize: '11px' }}>Validade da ART/RRT</label>
                  <input
                    className="input"
                    type="date"
                    value={vincValidade}
                    onChange={e => setVincValidade(e.target.value)}
                  />
                </div>

                <div className="form-field">
                  <label style={{ fontSize: '11px' }}>Situação do vínculo</label>
                  <select
                    className="select"
                    value={vincSituacao}
                    onChange={e => setVincSituacao(e.target.value)}
                  >
                    <option value="Ativo">Ativo</option>
                    <option value="Concluído">Concluído</option>
                    <option value="Cancelado">Cancelado</option>
                    <option value="Em Análise">Em Análise</option>
                  </select>
                </div>

                <div className="form-field full">
                  <label style={{ fontSize: '11px' }}>Observação específica da ART (opcional)</label>
                  <input
                    className="input"
                    value={vincObs}
                    onChange={e => setVincObs(e.target.value)}
                    placeholder="Ex: Relatório periódico de segurança / Vistoria anual"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn green small"
                  onClick={handleAddOrUpdateVinculo}
                >
                  {editingVincIndex !== null ? 'Salvar alteração no vínculo' : '＋ Adicionar vínculo à ficha'}
                </button>
                {editingVincIndex !== null && (
                  <button
                    type="button"
                    className="btn soft small"
                    onClick={() => {
                      setEditingVincIndex(null);
                      setVincArt('');
                      setVincBarragem('');
                      setVincValidade('');
                      setVincObs('');
                    }}
                  >
                    Cancelar edição
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn green">Salvar ficha do profissional</button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// 4. MODAL GENÉRICO (USUÁRIOS E DEMAIS MÓDULOS)
// ============================================================================
export function GenericRecordModal({
  config,
  record,
  isNew,
  onClose,
  onSubmit
}: {
  config: any;
  record: any;
  isNew: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <h3>
            {isNew ? 'Novo cadastro' : 'Editar cadastro'} · {config.singular}
          </h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            {config.fields.map((field: any) => {
              const value = record[field.name] ?? '';
              return (
                <div key={field.name} className={`form-field ${field.full ? 'full' : ''}`}>
                  <label>
                    {field.label}
                    {field.required ? ' · obrigatório' : ''}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      className="select"
                      name={field.name}
                      defaultValue={value}
                      required={field.required}
                    >
                      <option value="">Selecione...</option>
                      {field.options?.map((opt: string) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      className="textarea"
                      name={field.name}
                      defaultValue={value}
                      required={field.required}
                    />
                  ) : (
                    <input
                      className="input"
                      name={field.name}
                      type={field.type || 'text'}
                      defaultValue={value}
                      required={field.required}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn green">Salvar cadastro</button>
        </div>
      </form>
    </div>
  );
}
