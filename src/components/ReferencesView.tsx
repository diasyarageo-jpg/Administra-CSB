import React, { useState } from 'react';
import { BookOpen, Scale, FileText, CheckCircle2, AlertTriangle, ExternalLink, HelpCircle } from 'lucide-react';

export const ReferencesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'normas' | 'matriz' | 'prazos' | 'glosario'>('matriz');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 tracking-wider uppercase mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            Base Legal & Critérios Técnicos de Enquadramento
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Referências Centrais & Marco Normativo
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manual de consulta para analistas e fiscais da CSB/SEMA-MT em conformidade com a Política Nacional de Segurança de Barragens (PNSB).
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white p-2 rounded-xl shadow-xs overflow-x-auto text-xs font-bold">
        <button
          onClick={() => setActiveTab('matriz')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeTab === 'matriz'
              ? 'bg-emerald-700 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Matriz de Enquadramento (CNRH 143/2012)
        </button>
        <button
          onClick={() => setActiveTab('normas')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeTab === 'normas'
              ? 'bg-emerald-700 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Legislação Vigente & Decretos
        </button>
        <button
          onClick={() => setActiveTab('prazos')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeTab === 'prazos'
              ? 'bg-emerald-700 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Prazos de ISR e Revisões Periódicas
        </button>
        <button
          onClick={() => setActiveTab('glosario')}
          className={`px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
            activeTab === 'glosario'
              ? 'bg-emerald-700 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Glossário de Termos Técnicos
        </button>
      </div>

      {/* TAB: MATRIZ DE ENQUADRAMENTO */}
      {activeTab === 'matriz' && (
        <div className="space-y-6 text-xs">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wider mb-2">
              Cruzamento entre Categoria de Risco (CRI) e Dano Potencial Associado (DPA)
            </h3>
            <p className="text-slate-600 mb-6 leading-relaxed">
              De acordo com a Resolução CNRH nº 143/2012 e diretrizes da Agência Nacional de Águas (ANA), as barragens são classificadas em quatro categorias (Classes A, B, C e D) em função do risco estrutural e do potencial de dano humano, econômico e ambiental a jusante.
            </p>

            {/* Official Matrix Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-center border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-bold">
                    <th className="p-3 border border-slate-300 text-left">
                      Dano Potencial Associado (DPA) \ Categoria de Risco (CRI)
                    </th>
                    <th className="p-3 border border-slate-300 bg-slate-200/80">CRI Alto</th>
                    <th className="p-3 border border-slate-300 bg-slate-200/80">CRI Médio</th>
                    <th className="p-3 border border-slate-300 bg-slate-200/80">CRI Baixo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-3 border border-slate-300 font-bold text-left bg-rose-50/50 text-rose-950">
                      DPA Alto (Perda de vidas provável / Alto dano)
                    </td>
                    <td className="p-4 border border-slate-300 bg-rose-100 text-rose-900 font-black text-sm">
                      Classe A
                    </td>
                    <td className="p-4 border border-slate-300 bg-amber-100 text-amber-900 font-black text-sm">
                      Classe B
                    </td>
                    <td className="p-4 border border-slate-300 bg-amber-100 text-amber-900 font-black text-sm">
                      Classe B
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 border border-slate-300 font-bold text-left bg-amber-50/50 text-amber-950">
                      DPA Médio (Sem perda de vidas / Impacto ambiental moderado)
                    </td>
                    <td className="p-4 border border-slate-300 bg-amber-100 text-amber-900 font-black text-sm">
                      Classe B
                    </td>
                    <td className="p-4 border border-slate-300 bg-blue-100 text-blue-900 font-black text-sm">
                      Classe C
                    </td>
                    <td className="p-4 border border-slate-300 bg-blue-100 text-blue-900 font-black text-sm">
                      Classe C
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 border border-slate-300 font-bold text-left bg-blue-50/50 text-blue-950">
                      DPA Baixo (Área rural desabitada / Baixo impacto)
                    </td>
                    <td className="p-4 border border-slate-300 bg-blue-100 text-blue-900 font-black text-sm">
                      Classe C
                    </td>
                    <td className="p-4 border border-slate-300 bg-slate-100 text-slate-800 font-black text-sm">
                      Classe D
                    </td>
                    <td className="p-4 border border-slate-300 bg-slate-100 text-slate-800 font-black text-sm">
                      Classe D
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Explanatory cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <h4 className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">
                  <CheckCircle2 size={16} className="text-emerald-700" />
                  Critérios de Avaliação do CRI (Categoria de Risco)
                </h4>
                <ul className="list-disc pl-4 space-y-1 text-slate-600 mt-2">
                  <li><strong>Características técnicas:</strong> altura, comprimento, tipo de maciço, fundação e idade.</li>
                  <li><strong>Estado de conservação:</strong> fissuras, trincas, erosões, percolação anormal e abatimentos.</li>
                  <li><strong>Plano de Segurança:</strong> documentação de projeto, manuais de operação e instrumentação.</li>
                </ul>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                <h4 className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={16} className="text-amber-700" />
                  Critérios de Avaliação do DPA (Dano Potencial)
                </h4>
                <ul className="list-disc pl-4 space-y-1 text-slate-600 mt-2">
                  <li><strong>Potencial de perda de vidas humanas:</strong> presença de habitações a jusante na mancha de inundação.</li>
                  <li><strong>Impacto ambiental:</strong> volume do reservatório, toxicidade de efluentes ou rejeitos de mineração.</li>
                  <li><strong>Impacto socioeconômico:</strong> interrupção de estradas, captações de água e usinas a jusante.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: LEGISLAÇÃO */}
      {activeTab === 'normas' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-sm text-slate-900">Lei Federal nº 12.334/2010</span>
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">Marco Principal</span>
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Estabelece a Política Nacional de Segurança de Barragens (PNSB) e cria o Sistema Nacional de Informações sobre Segurança de Barragens (SNISB).
              </p>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-sm text-slate-900">Lei Federal nº 14.066/2020</span>
                <span className="text-[10px] font-bold text-blue-800 bg-blue-100 px-2 py-0.5 rounded">Atualização Pós-Brumadinho</span>
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Proíbe a construção ou alteamento de barragens de mineração pelo método a montante, intensifica multas e obriga plano de emergência com sirenes e rotas de fuga.
              </p>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-sm text-slate-900">Resolução CNRH nº 143/2012</span>
                <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">Critérios Gerais</span>
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Estabelece critérios gerais de classificação de barragens por Categoria de Risco e Dano Potencial Associado.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="font-black text-sm text-slate-900">Resolução CNRH nº 144/2012</span>
                <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">Diretrizes do PSB</span>
              </div>
              <p className="text-slate-600 mt-1 leading-relaxed">
                Estabelece diretrizes para a elaboração do Plano de Segurança de Barragens (PSB) e para as revisões periódicas.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB: PRAZOS */}
      {activeTab === 'prazos' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
              Cronograma Obrigatório de Inspeções Técnicas
            </h3>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="font-extrabold text-slate-900 block">Inspeção de Segurança Regular (ISR)</span>
                <p className="text-slate-600 mt-1">Periodicidade: <strong>Anual</strong>. O relatório assinado pelo Responsável Técnico com ART deve ser entregue à SEMA-MT até 31 de dezembro de cada ano.</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="font-extrabold text-slate-900 block">Inspeção de Segurança Especial (ISE)</span>
                <p className="text-slate-600 mt-1">Acionada extraordinariamente pelo fiscal ou empreendedor sempre que houver anomalias, abalos sísmicos, eventos hidrológicos extremos ou alteração substancial no maciço.</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="font-extrabold text-slate-900 block">Revisão Periódica de Segurança de Barragens (RPSB)</span>
                <p className="text-slate-600 mt-1">
                  Exame aprofundado de conformidade de projeto e segurança global:
                  <br />· <strong>Classe A:</strong> A cada 3 anos
                  <br />· <strong>Classe B:</strong> A cada 5 anos
                  <br />· <strong>Classe C:</strong> A cada 7 anos
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: GLOSSÁRIO */}
      {activeTab === 'glosario' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs text-xs space-y-3">
          <div>
            <strong className="text-slate-900">PSB (Plano de Segurança de Barragens):</strong>
            <p className="text-slate-600">Instrumento de gestão que reúne todos os dados técnicos, manuais operacionais, histórico de inspeções e monitoramento de uma barragem.</p>
          </div>
          <div>
            <strong className="text-slate-900">PAE (Plano de Ação de Emergência):</strong>
            <p className="text-slate-600">Documento que estabelece os procedimentos a serem seguidos pelo empreendedor e pela Defesa Civil em caso de risco iminente de rompimento ou anomalia grave.</p>
          </div>
          <div>
            <strong className="text-slate-900">ZAS (Zona de Autossalvamento):</strong>
            <p className="text-slate-600">Região do vale a jusante da barragem onde se considera que não há tempo suficiente para intervenção das autoridades competentes em situação de emergência (geralmente menor entre 10 km ou tempo de onda de 30 minutos).</p>
          </div>
          <div>
            <strong className="text-slate-900">ART (Anotação de Responsabilidade Técnica):</strong>
            <p className="text-slate-600">Instrumento legal expedido pelo CREA que define os responsáveis técnicos pelo projeto, construção, operação ou vistoria da estrutura.</p>
          </div>
        </div>
      )}
    </div>
  );
};
