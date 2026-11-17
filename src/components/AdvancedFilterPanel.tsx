import React from 'react';
import {
  BarragensAdvancedFilters,
  EmpreendedoresAdvancedFilters,
  PortariasAdvancedFilters,
  ProdutividadeAdvancedFilters,
  RtsAdvancedFilters,
  UsuariosAdvancedFilters,
  collectDistinctValues
} from '../utils/databaseAdvancedFilters';
import { PERFIS_PROFISSIONAIS, SETORES } from '../types/auth';

export const AdvancedFilterToggleButton: React.FC<{
  isOpen: boolean;
  activeCount: number;
  onToggle: () => void;
}> = ({ isOpen, activeCount, onToggle }) => (
  <button
    type="button"
    className={`btn light small adv-filter-toggle${isOpen ? ' is-open' : ''}${activeCount > 0 ? ' has-active' : ''}`}
    aria-expanded={isOpen}
    onClick={onToggle}
  >
    <span>Pesquisa avançada</span>
    {activeCount > 0 && <span className="adv-filter-count">{activeCount}</span>}
    <span aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
  </button>
);

export const AdvancedFilterDrawer: React.FC<{
  title: string;
  subtitle?: string;
  activeCount: number;
  onClear: () => void;
  onClose?: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, activeCount, onClear, onClose, children }) => (
  <div className="adv-filter-drawer">
    <div className="adv-filter-head">
      <div>
        <div className="adv-filter-title">{title}</div>
        {subtitle && <div className="adv-filter-sub">{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {activeCount > 0 && (
          <span className="badge green">{activeCount} filtro(s) ativo(s)</span>
        )}
        {onClose && (
          <button type="button" className="btn light small" onClick={onClose}>
            Recolher ▲
          </button>
        )}
      </div>
    </div>

    <div className="adv-filter-grid">{children}</div>

    <div className="adv-filter-foot">
      <span className="micro muted">
        Combine quantos campos desejar para refinar a consulta na base de dados.
      </span>
      <button
        type="button"
        className="btn light small"
        onClick={onClear}
        disabled={activeCount === 0}
      >
        Limpar filtros avançados
      </button>
    </div>
  </div>
);

export const AdvancedFilterField: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div className="adv-filter-field">
    <label>{label}</label>
    {children}
  </div>
);

// ============================================================================
// 1. EMPREENDEDORES
// ============================================================================
export const EmpreendedoresAdvancedPanel: React.FC<{
  filters: EmpreendedoresAdvancedFilters;
  records: any[];
  activeCount: number;
  onChange: (next: EmpreendedoresAdvancedFilters) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, records, activeCount, onChange, onClear, onClose }) => {
  const tiposPessoa = collectDistinctValues(
    [{ tipoPessoa: 'Pessoa física' }, { tipoPessoa: 'Pessoa jurídica' }, ...records],
    r => r.tipoPessoa
  );
  const ufs = collectDistinctValues(records, r => r.uf);
  const municipios = collectDistinctValues(records, r => r.municipio);
  const situacoes = collectDistinctValues(
    [{ situacao: 'Ativo' }, { situacao: 'Inativo' }, { situacao: 'Aguardando confirmação' }, ...records],
    r => r.situacao
  );

  const setField = <K extends keyof EmpreendedoresAdvancedFilters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Empreendedores"
      subtitle="Todos os campos cadastrais, vínculos de empreendimentos/CAR, barragens e datas"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Nome / Razão social">
        <input
          className="input"
          placeholder="Filtrar nome ou razão social..."
          value={filters.nome}
          onChange={e => setField('nome', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Nome fantasia">
        <input
          className="input"
          placeholder="Filtrar nome fantasia..."
          value={filters.nomeFantasia}
          onChange={e => setField('nomeFantasia', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="CPF / CNPJ">
        <input
          className="input"
          placeholder="Número ou trecho do CPF/CNPJ..."
          value={filters.cpfCnpj}
          onChange={e => setField('cpfCnpj', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Tipo de pessoa">
        <select
          className="select"
          value={filters.tipoPessoa}
          onChange={e => setField('tipoPessoa', e.target.value)}
        >
          <option value="Todos">Todos os tipos</option>
          {tiposPessoa.map(tp => (
            <option key={tp} value={tp}>{tp}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="E-mail">
        <input
          className="input"
          placeholder="Filtrar e-mail..."
          value={filters.email}
          onChange={e => setField('email', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Telefone">
        <input
          className="input"
          placeholder="Filtrar telefone..."
          value={filters.telefone}
          onChange={e => setField('telefone', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="UF">
        <select
          className="select"
          value={filters.uf}
          onChange={e => setField('uf', e.target.value)}
        >
          <option value="Todas">Todas as UFs</option>
          {ufs.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Município / IBGE">
        <input
          className="input"
          list="adv-emp-municipios"
          placeholder="Município ou código IBGE..."
          value={filters.municipio}
          onChange={e => setField('municipio', e.target.value)}
        />
        <datalist id="adv-emp-municipios">
          {municipios.map(m => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Situação cadastral">
        <select
          className="select"
          value={filters.situacao}
          onChange={e => setField('situacao', e.target.value)}
        >
          <option value="Todas">Todas as situações</option>
          {situacoes.map(st => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Empreendimentos / CAR">
        <select
          className="select"
          value={filters.empreendimentoStatus}
          onChange={e => setField('empreendimentoStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="com_empreendimentos">Com empreendimentos</option>
          <option value="sem_empreendimentos">Sem empreendimentos</option>
          <option value="com_car">Com CAR vinculado</option>
          <option value="sem_car">Sem CAR vinculado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Vínculo com barragens">
        <select
          className="select"
          value={filters.barragemStatus}
          onChange={e => setField('barragemStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="com_barragens">Com barragens vinculadas</option>
          <option value="sem_barragens">Sem barragens vinculadas</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="CAR / Escritura / Empreendimento">
        <input
          className="input"
          placeholder="CAR/MT, escritura ou nome..."
          value={filters.empreendimentoTexto}
          onChange={e => setField('empreendimentoTexto', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Barragem ou processo vinculado">
        <input
          className="input"
          placeholder="Nome da barragem, processo ou SNISB..."
          value={filters.barragemOuProcesso}
          onChange={e => setField('barragemOuProcesso', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Observações">
        <input
          className="input"
          placeholder="Trecho nas observações..."
          value={filters.observacoes}
          onChange={e => setField('observacoes', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Atualização / cadastro (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.dataInicio}
            onChange={e => setField('dataInicio', e.target.value)}
            aria-label="Data inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.dataFim}
            onChange={e => setField('dataFim', e.target.value)}
            aria-label="Data final"
          />
        </div>
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};

// ============================================================================
// 2. BARRAGENS CADASTRADAS
// ============================================================================
export const BarragensAdvancedPanel: React.FC<{
  filters: BarragensAdvancedFilters;
  records: any[];
  empreendedores: any[];
  activeCount: number;
  onChange: (next: BarragensAdvancedFilters) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, records, empreendedores, activeCount, onChange, onClear, onClose }) => {
  const ufs = collectDistinctValues([{ uf: 'MT' }, ...records], r => r.uf);
  const municipios = collectDistinctValues(records, r => r.municipio);
  const situacoes = collectDistinctValues(
    [{ situacao: 'Ativa' }, { situacao: 'Inativa' }, { situacao: 'Aguardando confirmação' }, ...records],
    r => r.situacao
  );
  const empOptions = collectDistinctValues(empreendedores, e => e.nome || e.nomeFantasia);

  const setField = <K extends keyof BarragensAdvancedFilters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Barragens cadastradas"
      subtitle="Todos os atributos cadastrais, localização, classificações (DPA/CRI), dimensões e datas"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Nome da barragem">
        <input
          className="input"
          placeholder="Identificação / nome..."
          value={filters.nome}
          onChange={e => setField('nome', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="CAR / MT">
        <input
          className="input"
          placeholder="Número do CAR..."
          value={filters.car}
          onChange={e => setField('car', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Status do CAR/MT">
        <select
          className="select"
          value={filters.carStatus}
          onChange={e => setField('carStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="com_car">Com CAR informado</option>
          <option value="sem_car">Sem CAR informado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="UF">
        <select
          className="select"
          value={filters.uf}
          onChange={e => setField('uf', e.target.value)}
        >
          <option value="Todas">Todas as UFs</option>
          {ufs.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Município / IBGE">
        <input
          className="input"
          list="adv-dam-municipios"
          placeholder="Município ou código IBGE..."
          value={filters.municipio}
          onChange={e => setField('municipio', e.target.value)}
        />
        <datalist id="adv-dam-municipios">
          {municipios.map(m => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Vínculo com empreendedor">
        <select
          className="select"
          value={filters.empreendedorStatus}
          onChange={e => setField('empreendedorStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="com_empreendedor">Com empreendedor vinculado</option>
          <option value="sem_empreendedor">Sem empreendedor vinculado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Empreendedor">
        <input
          className="input"
          list="adv-dam-emps"
          placeholder="Nome ou ID do empreendedor..."
          value={filters.empreendedor}
          onChange={e => setField('empreendedor', e.target.value)}
        />
        <datalist id="adv-dam-emps">
          {empOptions.map(emp => (
            <option key={emp} value={emp} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Empreendimento">
        <input
          className="input"
          placeholder="Nome do empreendimento..."
          value={filters.empreendimento}
          onChange={e => setField('empreendimento', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Número do processo">
        <input
          className="input"
          placeholder="Nº do processo..."
          value={filters.processo}
          onChange={e => setField('processo', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Identificador SNISB">
        <input
          className="input"
          placeholder="Código SNISB..."
          value={filters.snisb}
          onChange={e => setField('snisb', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Curso d’água">
        <input
          className="input"
          placeholder="Rio ou córrego..."
          value={filters.cursoAgua}
          onChange={e => setField('cursoAgua', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Coordenadas geográficas">
        <select
          className="select"
          value={filters.coordenadasStatus}
          onChange={e => setField('coordenadasStatus', e.target.value)}
        >
          <option value="Todos">Todas</option>
          <option value="com_coordenadas">Com coordenadas válidas</option>
          <option value="sem_coordenadas">Sem coordenadas válidas</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Dano Potencial (DPA)">
        <select
          className="select"
          value={filters.danoPotencial}
          onChange={e => setField('danoPotencial', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="Alto">Alto</option>
          <option value="Médio">Médio</option>
          <option value="Baixo">Baixo</option>
          <option value="Não classificada">Não classificada</option>
          <option value="nao_informado">Não informado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Categoria de Risco (CRI)">
        <select
          className="select"
          value={filters.categoriaRisco}
          onChange={e => setField('categoriaRisco', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="Alto">Alto</option>
          <option value="Médio">Médio</option>
          <option value="Baixo">Baixo</option>
          <option value="Não classificada">Não classificada</option>
          <option value="nao_informado">Não informado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Altura em metros (mín / máx)">
        <div className="adv-filter-range">
          <input
            type="number"
            step="any"
            className="input"
            placeholder="Mín (m)"
            value={filters.alturaMin}
            onChange={e => setField('alturaMin', e.target.value)}
          />
          <input
            type="number"
            step="any"
            className="input"
            placeholder="Máx (m)"
            value={filters.alturaMax}
            onChange={e => setField('alturaMax', e.target.value)}
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Volume (mín / máx)">
        <div className="adv-filter-range">
          <input
            type="number"
            step="any"
            className="input"
            placeholder="Mín"
            value={filters.volumeMin}
            onChange={e => setField('volumeMin', e.target.value)}
          />
          <input
            type="number"
            step="any"
            className="input"
            placeholder="Máx"
            value={filters.volumeMax}
            onChange={e => setField('volumeMax', e.target.value)}
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Situação cadastral">
        <select
          className="select"
          value={filters.situacao}
          onChange={e => setField('situacao', e.target.value)}
        >
          <option value="Todas">Todas as situações</option>
          {situacoes.map(st => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Classificada em (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.classificadaInicio}
            onChange={e => setField('classificadaInicio', e.target.value)}
            aria-label="Classificação inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.classificadaFim}
            onChange={e => setField('classificadaFim', e.target.value)}
            aria-label="Classificação final"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Atualização / cadastro (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.atualizadaInicio}
            onChange={e => setField('atualizadaInicio', e.target.value)}
            aria-label="Atualização inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.atualizadaFim}
            onChange={e => setField('atualizadaFim', e.target.value)}
            aria-label="Atualização final"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Observações">
        <input
          className="input"
          placeholder="Trecho nas observações..."
          value={filters.observacoes}
          onChange={e => setField('observacoes', e.target.value)}
        />
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};

// ============================================================================
// 3. RESPONSÁVEIS TÉCNICOS
// ============================================================================
export const RtsAdvancedPanel: React.FC<{
  filters: RtsAdvancedFilters;
  records: any[];
  barragens: any[];
  activeCount: number;
  onChange: (next: RtsAdvancedFilters) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, records, barragens, activeCount, onChange, onClear, onClose }) => {
  const conselhos = collectDistinctValues([{ conselho: 'CREA-MT' }, ...records], r => r.conselho);
  const ufsConselho = collectDistinctValues([{ ufConselho: 'MT' }, ...records], r => r.ufConselho);
  const situacoes = collectDistinctValues(
    [{ situacao: 'Ativo' }, { situacao: 'Inativo' }, { situacao: 'Aguardando confirmação' }, ...records],
    r => r.situacao
  );
  const damNames = collectDistinctValues(barragens, b => b.nome);

  const setField = <K extends keyof RtsAdvancedFilters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Responsáveis Técnicos"
      subtitle="Todos os dados profissionais, conselho/registro, ARTs/RRTs, barragens vinculadas e validade"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Nome completo">
        <input
          className="input"
          placeholder="Nome do profissional..."
          value={filters.nome}
          onChange={e => setField('nome', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="CPF">
        <input
          className="input"
          placeholder="CPF ou dígitos..."
          value={filters.cpf}
          onChange={e => setField('cpf', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Conselho profissional">
        <select
          className="select"
          value={filters.conselho}
          onChange={e => setField('conselho', e.target.value)}
        >
          <option value="Todos">Todos os conselhos</option>
          {conselhos.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="UF do conselho">
        <select
          className="select"
          value={filters.ufConselho}
          onChange={e => setField('ufConselho', e.target.value)}
        >
          <option value="Todas">Todas as UFs</option>
          {ufsConselho.map(u => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Número de registro">
        <input
          className="input"
          placeholder="Nº registro no conselho..."
          value={filters.registro}
          onChange={e => setField('registro', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Especialidades">
        <input
          className="input"
          placeholder="Ex.: Civil, Geotécnica..."
          value={filters.especialidades}
          onChange={e => setField('especialidades', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="E-mail">
        <input
          className="input"
          placeholder="E-mail de contato..."
          value={filters.email}
          onChange={e => setField('email', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Telefone">
        <input
          className="input"
          placeholder="Telefone de contato..."
          value={filters.telefone}
          onChange={e => setField('telefone', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Número da ART / RRT">
        <input
          className="input"
          placeholder="Nº ART ou RRT..."
          value={filters.artRrt}
          onChange={e => setField('artRrt', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Barragem vinculada">
        <input
          className="input"
          list="adv-rt-barragens"
          placeholder="Nome ou ID da barragem..."
          value={filters.barragemVinculada}
          onChange={e => setField('barragemVinculada', e.target.value)}
        />
        <datalist id="adv-rt-barragens">
          {damNames.map(d => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Processo vinculado">
        <input
          className="input"
          placeholder="Número do processo..."
          value={filters.processo}
          onChange={e => setField('processo', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Status da validade ART/RRT">
        <select
          className="select"
          value={filters.validadeStatus}
          onChange={e => setField('validadeStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="vigente">Vigente</option>
          <option value="vencida">Vencida</option>
          <option value="sem_validade">Sem validade informada</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Validade ART/RRT (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.validadeInicio}
            onChange={e => setField('validadeInicio', e.target.value)}
            aria-label="Validade inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.validadeFim}
            onChange={e => setField('validadeFim', e.target.value)}
            aria-label="Validade final"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Consistência de identificador">
        <select
          className="select"
          value={filters.revisaoStatus}
          onChange={e => setField('revisaoStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="revisao_necessaria">Revisão necessária (sem CPF/reg.)</option>
          <option value="confiavel">Identificador confiável</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Situação">
        <select
          className="select"
          value={filters.situacao}
          onChange={e => setField('situacao', e.target.value)}
        >
          <option value="Todas">Todas as situações</option>
          {situacoes.map(st => (
            <option key={st} value={st}>{st}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Observações">
        <input
          className="input"
          placeholder="Trecho nas observações..."
          value={filters.observacoes}
          onChange={e => setField('observacoes', e.target.value)}
        />
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};

// ============================================================================
// 4. USUÁRIOS
// ============================================================================
export const UsuariosAdvancedPanel: React.FC<{
  filters: UsuariosAdvancedFilters;
  records: any[];
  activeCount: number;
  onChange: (next: UsuariosAdvancedFilters) => void;
  onSyncSituacao: (situacao: string) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, records, activeCount, onChange, onSyncSituacao, onClear, onClose }) => {
  const perfis = collectDistinctValues(
    [...PERFIS_PROFISSIONAIS.map(p => ({ perfilProfissional: p })), ...records],
    r => r.perfilProfissional
  );
  const setores = collectDistinctValues(
    [...SETORES.map(s => ({ setor: s })), ...records],
    r => r.setor
  );

  const setField = <K extends keyof UsuariosAdvancedFilters>(key: K, value: string) => {
    if (key === 'situacao') {
      onSyncSituacao(value);
    }
    onChange({ ...filters, [key]: value });
  };

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Usuários"
      subtitle="Todos os campos funcionais, perfil, setor, papel RBAC e situação"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Nome do servidor">
        <input
          className="input"
          placeholder="Nome completo..."
          value={filters.nome}
          onChange={e => setField('nome', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Matrícula funcional">
        <input
          className="input"
          placeholder="Matrícula..."
          value={filters.matricula}
          onChange={e => setField('matricula', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Login / Identificação de acesso">
        <input
          className="input"
          placeholder="Login..."
          value={filters.login}
          onChange={e => setField('login', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="E-mail institucional">
        <input
          className="input"
          placeholder="E-mail..."
          value={filters.email}
          onChange={e => setField('email', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Perfil profissional">
        <select
          className="select"
          value={filters.perfilProfissional}
          onChange={e => setField('perfilProfissional', e.target.value)}
        >
          <option value="Todos">Todos os perfis</option>
          {perfis.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Setor de lotação">
        <select
          className="select"
          value={filters.setor}
          onChange={e => setField('setor', e.target.value)}
        >
          <option value="Todos">Todos os setores</option>
          {setores.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Papel de acesso (RBAC)">
        <select
          className="select"
          value={filters.papel}
          onChange={e => setField('papel', e.target.value)}
        >
          <option value="Todos">Todos os papéis</option>
          <option value="Administrador">Administrador</option>
          <option value="Usuário">Usuário</option>
          <option value="Visualizador">Visualizador</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Situação funcional">
        <select
          className="select"
          value={filters.situacao}
          onChange={e => setField('situacao', e.target.value)}
        >
          <option value="Todos">Todas</option>
          <option value="Ativo">Ativo</option>
          <option value="Pendente">Pendente</option>
          <option value="Inativo">Inativo</option>
          <option value="Recusado">Recusado</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Observações">
        <input
          className="input"
          placeholder="Trecho nas observações..."
          value={filters.observacoes}
          onChange={e => setField('observacoes', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Cadastro / atualização (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.dataInicio}
            onChange={e => setField('dataInicio', e.target.value)}
            aria-label="Data inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.dataFim}
            onChange={e => setField('dataFim', e.target.value)}
            aria-label="Data final"
          />
        </div>
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};

// ============================================================================
// 5. PRODUTIVIDADE SURH
// ============================================================================
export const ProdutividadeAdvancedPanel: React.FC<{
  filters: ProdutividadeAdvancedFilters;
  records: any[];
  surhProducts: Array<{ code: string; title: string; points: number }>;
  activeCount: number;
  onChange: (next: ProdutividadeAdvancedFilters) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, records, surhProducts, activeCount, onChange, onClear, onClose }) => {
  const servidores = collectDistinctValues(records, r => r.serverName);
  const unidades = collectDistinctValues(records, r => r.unit);

  const setField = <K extends keyof ProdutividadeAdvancedFilters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Produtividade SURH"
      subtitle="Todos os campos dos lançamentos: servidor, unidade, código SURH, origem, validação e período"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Servidor">
        <input
          className="input"
          list="adv-prod-servidores"
          placeholder="Nome do servidor..."
          value={filters.serverName}
          onChange={e => setField('serverName', e.target.value)}
        />
        <datalist id="adv-prod-servidores">
          {servidores.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Unidade / Setor">
        <input
          className="input"
          list="adv-prod-unidades"
          placeholder="Unidade ou setor..."
          value={filters.unit}
          onChange={e => setField('unit', e.target.value)}
        />
        <datalist id="adv-prod-unidades">
          {unidades.map(u => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </AdvancedFilterField>

      <AdvancedFilterField label="Tipo de lançamento">
        <select
          className="select"
          value={filters.kind}
          onChange={e => setField('kind', e.target.value)}
        >
          <option value="Todos">Todos os tipos</option>
          <option value="scored">Produto SURH (pontuado)</option>
          <option value="unscored">Sem pontuação</option>
          <option value="extra">Atividade extra (art. 8º)</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Código do produto">
        <select
          className="select"
          value={filters.productCode}
          onChange={e => setField('productCode', e.target.value)}
        >
          <option value="Todos">Todos os códigos</option>
          <option value="ART. 8º">ART. 8º (Extra)</option>
          {surhProducts.map(p => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.points} pts
            </option>
          ))}
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Origem do registro">
        <select
          className="select"
          value={filters.sourceType}
          onChange={e => setField('sourceType', e.target.value)}
        >
          <option value="Todos">Todas as origens</option>
          <option value="manual">Lançamento manual</option>
          <option value="system">Registro de sistema</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Sistema / Nome da origem">
        <input
          className="input"
          placeholder="Ex.: Notifica, Classifica..."
          value={filters.sourceName}
          onChange={e => setField('sourceName', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Processo de referência">
        <input
          className="input"
          placeholder="Número do processo..."
          value={filters.processRef}
          onChange={e => setField('processRef', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Documento de referência">
        <input
          className="input"
          placeholder="Número do documento..."
          value={filters.documentRef}
          onChange={e => setField('documentRef', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Validação de atividade extra">
        <select
          className="select"
          value={filters.extraStatus}
          onChange={e => setField('extraStatus', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="Pendente">Pendente</option>
          <option value="Aguardando validação">Aguardando validação</option>
          <option value="Aprovada">Aprovada</option>
          <option value="Não aprovada">Não aprovada</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Coordenador validador">
        <input
          className="input"
          placeholder="Nome do coordenador..."
          value={filters.coordinator}
          onChange={e => setField('coordinator', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Planilha oficial">
        <select
          className="select"
          value={filters.inOfficialSheet}
          onChange={e => setField('inOfficialSheet', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="sim">Inserido na planilha</option>
          <option value="nao">Pendente de inserção</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Pontos aprovados (mín / máx)">
        <div className="adv-filter-range">
          <input
            type="number"
            className="input"
            placeholder="Mín"
            value={filters.pontosMin}
            onChange={e => setField('pontosMin', e.target.value)}
          />
          <input
            type="number"
            className="input"
            placeholder="Máx"
            value={filters.pontosMax}
            onChange={e => setField('pontosMax', e.target.value)}
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Data da atividade (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.dataInicio}
            onChange={e => setField('dataInicio', e.target.value)}
            aria-label="Data inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.dataFim}
            onChange={e => setField('dataFim', e.target.value)}
            aria-label="Data final"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Descrição / Ordem / Notas">
        <input
          className="input"
          placeholder="Descrição, ordem de serviço ou notas..."
          value={filters.descricaoNotas}
          onChange={e => setField('descricaoNotas', e.target.value)}
        />
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};

// ============================================================================
// 6. PORTARIAS
// ============================================================================
export const PortariasAdvancedPanel: React.FC<{
  filters: PortariasAdvancedFilters;
  activeCount: number;
  onChange: (next: PortariasAdvancedFilters) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ filters, activeCount, onChange, onClear, onClose }) => {
  const setField = <K extends keyof PortariasAdvancedFilters>(key: K, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <AdvancedFilterDrawer
      title="Pesquisa avançada · Trâmites de Portarias"
      subtitle="Todos os campos do trâmite: processo, portaria, etapas de assinatura/publicação e datas"
      activeCount={activeCount}
      onClear={onClear}
      onClose={onClose}
    >
      <AdvancedFilterField label="Número do processo">
        <input
          className="input"
          placeholder="Nº do processo..."
          value={filters.processNumber}
          onChange={e => setField('processNumber', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Número da portaria">
        <input
          className="input"
          placeholder="Nº da portaria..."
          value={filters.orderNumber}
          onChange={e => setField('orderNumber', e.target.value)}
        />
      </AdvancedFilterField>

      <AdvancedFilterField label="Situação geral">
        <select
          className="select"
          value={filters.status}
          onChange={e => setField('status', e.target.value)}
        >
          <option value="Todos">Todas</option>
          <option value="Concluído">Concluído</option>
          <option value="Pendente">Pendente</option>
          <option value="Rascunho">Rascunho</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Assinatura do secretário">
        <select
          className="select"
          value={filters.secretarySigned}
          onChange={e => setField('secretarySigned', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="sim">Assinada</option>
          <option value="nao">Não assinada</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Publicação de extrato">
        <select
          className="select"
          value={filters.extractPublished}
          onChange={e => setField('extractPublished', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="sim">Publicado</option>
          <option value="nao">Pendente</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Publicação da portaria">
        <select
          className="select"
          value={filters.orderPublished}
          onChange={e => setField('orderPublished', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="sim">Publicada</option>
          <option value="nao">Pendente</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Rascunho">
        <select
          className="select"
          value={filters.draft}
          onChange={e => setField('draft', e.target.value)}
        >
          <option value="Todos">Todos</option>
          <option value="sim">Apenas rascunhos</option>
          <option value="nao">Exceto rascunhos</option>
        </select>
      </AdvancedFilterField>

      <AdvancedFilterField label="Data de envio (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.envioInicio}
            onChange={e => setField('envioInicio', e.target.value)}
            aria-label="Envio inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.envioFim}
            onChange={e => setField('envioFim', e.target.value)}
            aria-label="Envio final"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Data final (de / até)">
        <div className="adv-filter-range">
          <input
            type="date"
            className="input"
            value={filters.finalInicio}
            onChange={e => setField('finalInicio', e.target.value)}
            aria-label="Data final inicial"
          />
          <input
            type="date"
            className="input"
            value={filters.finalFim}
            onChange={e => setField('finalFim', e.target.value)}
            aria-label="Data final máxima"
          />
        </div>
      </AdvancedFilterField>

      <AdvancedFilterField label="Observações">
        <input
          className="input"
          placeholder="Trecho nas observações..."
          value={filters.notes}
          onChange={e => setField('notes', e.target.value)}
        />
      </AdvancedFilterField>
    </AdvancedFilterDrawer>
  );
};
