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

  // Empreendedores ativos e preservação de inativo/legado
  const activeEmps = empreendedores.filter(e => e.situacao === 'Ativo');
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
// 3. MODAL DE RESPONSÁVEIS TÉCNICOS E ART/RRT
// ============================================================================
export function RtModal({
  record,
  isNew,
  barragens,
  onClose,
  onSave
}: {
  record: any;
  isNew: boolean;
  barragens: any[];
  onClose: () => void;
  onSave: (savedRecord: any) => void;
}) {
  const [nome, setNome] = useState<string>(record.nome || '');
  const [cpf, setCpf] = useState<string>(record.cpf || '');
  const [conselho, setConselho] = useState<string>(record.conselho || 'CREA-MT');
  const [ufConselho, setUfConselho] = useState<string>(record.ufConselho || 'MT');
  const [registro, setRegistro] = useState<string>(record.registro || '');
  const [especialidades, setEspecialidades] = useState<string>(record.especialidades || '');
  const [email, setEmail] = useState<string>(record.email || '');
  const [telefone, setTelefone] = useState<string>(record.telefone || '');
  const [artRrt, setArtRrt] = useState<string>(record.artRrt || record.art || '');
  const [barragemVinculada, setBarragemVinculada] = useState<string>(
    record.barragemVinculada || record.barragensVinculadas?.[0] || ''
  );
  const [validade, setValidade] = useState<string>(record.validade || '');
  const [situacao, setSituacao] = useState<string>(record.situacao || 'Ativo');
  const [observacoes, setObservacoes] = useState<string>(record.observacoes || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      alert('Informe o nome do responsável técnico.');
      return;
    }
    if (!artRrt.trim()) {
      alert('Informe o número da ART/RRT.');
      return;
    }
    // OBRIGATÓRIO: Vincular cada ART/RRT a pelo menos uma barragem cadastrada
    if (!barragemVinculada.trim()) {
      alert('Vincule a ART/RRT a pelo menos uma barragem já cadastrada.');
      return;
    }

    onSave({
      ...record,
      nome: nome.trim(),
      cpf: cpf.trim(),
      conselho: conselho.trim(),
      ufConselho: ufConselho.trim(),
      registro: registro.trim(),
      especialidades: especialidades.trim(),
      email: email.trim(),
      telefone: telefone.trim(),
      art: artRrt.trim(),
      artRrt: artRrt.trim(),
      barragemVinculada: barragemVinculada.trim(),
      barragensVinculadas: [barragemVinculada.trim()],
      validade,
      situacao,
      observacoes: observacoes.trim()
    });
  };

  const isUnmatchedLegacyDam =
    Boolean(barragemVinculada) && !barragens.some(b => String(b.id) === String(barragemVinculada));

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={handleSubmit} style={{ width: 'min(720px, 100%)' }}>
        <div className="modal-head">
          <h3>{isNew ? 'Novo cadastro' : 'Editar cadastro'} · Responsável Técnico</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          <div className="form-grid">
            <div className="form-field">
              <label>Nome completo · obrigatório</label>
              <input
                className="input"
                required
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Nome do profissional"
              />
            </div>

            <div className="form-field">
              <label>CPF</label>
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
                placeholder="Ex: CREA, CAU, CRQ"
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
                placeholder="Número de registro no conselho"
              />
            </div>

            <div className="form-field">
              <label>Especialidades</label>
              <input
                className="input"
                value={especialidades}
                onChange={e => setEspecialidades(e.target.value)}
                placeholder="Engenharia Civil, Geotecnia, etc."
              />
            </div>

            <div className="form-field">
              <label>E-mail</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="engenheiro@email.com"
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

            {/* ART/RRT e Vinculação Obrigatória com Barragem */}
            <div className="form-field">
              <label>Número da ART/RRT · obrigatório</label>
              <input
                className="input"
                required
                value={artRrt}
                onChange={e => setArtRrt(e.target.value)}
                placeholder="Número da Anotação de Responsabilidade Técnica"
              />
            </div>

            <div className="form-field">
              <label>Validade da ART/RRT</label>
              <input
                className="input"
                type="date"
                value={validade}
                onChange={e => setValidade(e.target.value)}
              />
            </div>

            <div className="form-field full">
              <label>Barragem vinculada à ART/RRT · obrigatório</label>
              <select
                className="select"
                required
                value={barragemVinculada}
                onChange={e => setBarragemVinculada(e.target.value)}
              >
                <option value="">Selecione a barragem vinculada...</option>
                {barragens.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.nome}{b.municipio ? ` — ${b.municipio}` : ''}
                  </option>
                ))}
                {/* Preserva vínculo legado se não corresponder por ID */}
                {isUnmatchedLegacyDam && (
                  <option value={barragemVinculada}>
                    {resolveDamName(barragemVinculada, barragens)} (Texto original mantido)
                  </option>
                )}
              </select>

              {barragens.length === 0 && (
                <div className="notice amber" style={{ marginTop: '6px' }}>
                  Atenção: Não há barragens cadastradas no sistema. Cadastre pelo menos uma barragem no módulo "Barragens cadastradas" antes de salvar a ART/RRT.
                </div>
              )}
            </div>

            <div className="form-field">
              <label>Situação</label>
              <select className="select" value={situacao} onChange={e => setSituacao(e.target.value)}>
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
                <option value="Aguardando confirmação">Aguardando confirmação</option>
              </select>
            </div>

            <div className="form-field full">
              <label>Observações</label>
              <textarea
                className="textarea"
                value={observacoes}
                onChange={e => setObservacoes(e.target.value)}
                placeholder="Observações sobre a atuação ou ART/RRT"
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
