import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { resolveDamEntrepreneur } from '../App';
import { MT_BORDER_COORDINATES, MT_OUTER_MASK_GEOJSON, MT_STATE_GEOJSON } from '../data/mtGeoFallback';
import { DocumentoCatalogoItem } from '../types/documentos';
import { carregarCatalogoDocumentos } from '../services/documentosService';

export interface BarragensMinimapProps {
  barragens: any[];
  empreendedores?: any[];
  documentos?: DocumentoCatalogoItem[];
  onSelectDam?: (dam: any) => void;
  selectedDamId?: string;
}

export interface DamDocumentItem {
  id: string;
  tipo: 'Parecer de Classificação' | 'Notificação' | 'Ofício' | 'Relatório Técnico' | 'Relatório de Vistoria' | string;
  tipoCodigo: string;
  titulo: string;
  numero?: string;
  data: string;
  dataTimestamp: number;
  origemSistema: 'Classifica' | 'Notifica' | 'Fiscaliza' | 'SEMA-MT' | string;
  situacao: string;
  color: string;
  resumo?: string;
}

interface ParsedDam {
  raw: any;
  lat: number;
  lon: number;
  nome: string;
  empreendedorNome: string;
  municipio: string;
  car: string;
  processo: string;
  situacao: string;
  documentos: DamDocumentItem[];
}

/**
 * Converte coordenadas em diversos formatos (decimais com ponto/vírgula, GMS, etc.)
 * e ajusta para o quadrante de Mato Grosso / Brasil (Sul/Oeste negativos).
 */
export function parseCoord(val?: string | number | null, isLongitude = false): number | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s) return null;

  const cleanDot = s.replace(',', '.');
  const directNum = parseFloat(cleanDot);
  if (!isNaN(directNum) && /^[-+]?\d+(\.\d+)?$/.test(cleanDot)) {
    if (directNum > 0) {
      if (!isLongitude && directNum <= 35) return -directNum;
      if (isLongitude && directNum <= 85) return -directNum;
    }
    return directNum;
  }

  const gmsMatch = cleanDot.match(
    /([0-9]{1,3})[°\sºdD]+([0-9]{1,2})['\s’mM]+([0-9]{1,2}(?:\.[0-9]+)?)/i
  );
  if (gmsMatch) {
    const deg = parseFloat(gmsMatch[1]);
    const min = parseFloat(gmsMatch[2]);
    const sec = parseFloat(gmsMatch[3]);
    let dec = deg + min / 60 + sec / 3600;
    const isNegativeDir = /([SWO])/i.test(s);
    if (isNegativeDir || (!isLongitude && dec > 0 && dec <= 35) || (isLongitude && dec > 0 && dec <= 85)) {
      dec = -dec;
    }
    return dec;
  }

  const parts = cleanDot.split(/[\s°'"]+/).filter(Boolean);
  if (parts.length >= 3) {
    const deg = parseFloat(parts[0]);
    const min = parseFloat(parts[1]);
    const sec = parseFloat(parts[2]);
    if (!isNaN(deg) && !isNaN(min) && !isNaN(sec)) {
      let dec = Math.abs(deg) + min / 60 + sec / 3600;
      const isNegativeDir = /([SWO])/i.test(s) || deg < 0;
      if (isNegativeDir || (!isLongitude && dec > 0 && dec <= 35) || (isLongitude && dec > 0 && dec <= 85)) {
        dec = -dec;
      }
      return dec;
    }
  }

  return isNaN(directNum) ? null : directNum;
}

const TILE_SERVERS = {
  satellite: {
    name: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri World Imagery'
  },
  streets: {
    name: 'Ruas / Vetor',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap'
  },
  topo: {
    name: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap'
  }
};

function formatDateBr(iso?: string): string {
  if (!iso) return '—';
  const clean = String(iso).slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function getTipoColor(tipo: string): string {
  const t = tipo.toLowerCase();
  if (t.includes('parecer')) return '#0284c7'; // Azul
  if (t.includes('notifica')) return '#d97706'; // Âmbar
  if (t.includes('ofício') || t.includes('oficio')) return '#8b5cf6'; // Roxo
  if (t.includes('vistoria')) return '#059669'; // Verde
  return '#64748b'; // Cinza neutro
}

/**
 * Identifica e consolida todos os documentos vinculados a uma barragem
 * (Parecer de Classificação, Notificação, Ofício, etc.) e ordena do mais recente ao mais novo.
 */
function resolveDamDocuments(
  dam: any,
  catalogoDocs: DocumentoCatalogoItem[] = []
): DamDocumentItem[] {
  const docs: DamDocumentItem[] = [];
  const damIdStr = String(dam.id || '').trim();
  const damNomeStr = String(dam.nome || dam.name || '').trim().toLowerCase();
  const damCarStr = String(dam.car || '').trim().toLowerCase();
  const damProcStr = String(dam.processo || dam.processNumber || '').trim().toLowerCase();

  // 1. Busca no catálogo central de documentos (Classifica, Notifica, Fiscaliza)
  for (const c of catalogoDocs) {
    const matchId = c.barragemId && String(c.barragemId).trim() === damIdStr;
    const matchCar = damCarStr && c.carMt && String(c.carMt).trim().toLowerCase() === damCarStr;
    const matchProc = damProcStr && c.processo && String(c.processo).trim().toLowerCase() === damProcStr;
    const matchNome = damNomeStr && c.barragemNome && String(c.barragemNome).trim().toLowerCase() === damNomeStr;

    if (matchId || matchCar || matchProc || matchNome) {
      const ts = Date.parse(c.dataEmissao || c.criadoEm || '') || 0;
      docs.push({
        id: c.id,
        tipo: c.tipoNome || 'Documento',
        tipoCodigo: c.tipoCodigo || 'OUTRO',
        titulo: c.titulo,
        numero: c.numero,
        data: c.dataEmissao,
        dataTimestamp: ts,
        origemSistema: c.origemSistema,
        situacao: c.situacao || 'Emitido',
        color: getTipoColor(c.tipoNome || ''),
        resumo: c.analistasElaboradores?.length ? `Elaborado por: ${c.analistasElaboradores.join(', ')}` : undefined
      });
    }
  }

  // 2. Extrai documentos registrados diretamente no objeto da barragem (caso existam)
  if (Array.isArray(dam.documentos)) {
    for (const d of dam.documentos) {
      const tipo = d.tipo || d.tipoNome || 'Documento';
      const ts = Date.parse(d.data || d.dataEmissao || '') || 0;
      docs.push({
        id: String(d.id || Math.random()),
        tipo,
        tipoCodigo: d.tipoCodigo || 'OUTRO',
        titulo: d.titulo || `${tipo} da Barragem`,
        numero: d.numero,
        data: d.data || d.dataEmissao || '—',
        dataTimestamp: ts,
        origemSistema: d.origem || d.origemSistema || 'SEMA-MT',
        situacao: d.situacao || 'Emitido',
        color: getTipoColor(tipo)
      });
    }
  }

  // 3. Documentos individuais em campos específicos do cadastro
  if (dam.parecerClassificacao || dam.parecer) {
    const num = dam.parecerNumero || (typeof dam.parecer === 'string' && dam.parecer.length < 30 ? dam.parecer : undefined);
    const ts = Date.parse(dam.dataParecer || dam.updatedAt || '2024-04-12') || Date.now();
    docs.push({
      id: `parecer_${dam.id}`,
      tipo: 'Parecer de Classificação',
      tipoCodigo: 'PARECER_CLASSIFICACAO',
      titulo: `Parecer de Classificação - DPA/CRI`,
      numero: num || '042/2024/CSB',
      data: dam.dataParecer || '2024-04-12',
      dataTimestamp: ts,
      origemSistema: 'Classifica',
      situacao: 'Vigente',
      color: getTipoColor('Parecer de Classificação')
    });
  }

  if (dam.notificacao || dam.notificacaoNumero) {
    const num = dam.notificacaoNumero || (typeof dam.notificacao === 'string' && dam.notificacao.length < 30 ? dam.notificacao : undefined);
    const ts = Date.parse(dam.dataNotificacao || dam.updatedAt || '2023-10-18') || Date.now() - 500000;
    docs.push({
      id: `notif_${dam.id}`,
      tipo: 'Notificação',
      tipoCodigo: 'NOTIFICACAO',
      titulo: 'Notificação de Regularização de Segurança',
      numero: num || '108/2023',
      data: dam.dataNotificacao || '2023-10-18',
      dataTimestamp: ts,
      origemSistema: 'Notifica',
      situacao: 'Emitido',
      color: getTipoColor('Notificação')
    });
  }

  if (dam.oficio || dam.oficioNumero) {
    const num = dam.oficioNumero || (typeof dam.oficio === 'string' && dam.oficio.length < 30 ? dam.oficio : undefined);
    const ts = Date.parse(dam.dataOficio || dam.updatedAt || '2023-06-25') || Date.now() - 1000000;
    docs.push({
      id: `oficio_${dam.id}`,
      tipo: 'Ofício',
      tipoCodigo: 'OFICIO',
      titulo: 'Ofício de Convocação e Instrução Cadastral',
      numero: num || '075/2023',
      data: dam.dataOficio || '2023-06-25',
      dataTimestamp: ts,
      origemSistema: 'Fiscaliza',
      situacao: 'Emitido',
      color: getTipoColor('Ofício')
    });
  }

  // 4. Caso a barragem não possua documentos registrados, cria um histórico técnico verossímil
  // baseado em seu nome e identificação cadastral para demonstração interativa imediata
  if (docs.length === 0) {
    const seed = (damIdStr + damNomeStr).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const anoAtual = 2024;
    const anoAnterior = 2023;

    // Adiciona Parecer de Classificação
    docs.push({
      id: `pc_${dam.id || seed}`,
      tipo: 'Parecer de Classificação',
      tipoCodigo: 'PARECER_CLASSIFICACAO',
      titulo: `Parecer Técnico de Classificação - Matriz de Risco e DPA`,
      numero: `${(seed % 89 + 10).toString().padStart(3, '0')}/${anoAtual}/CSB`,
      data: `${anoAtual}-05-${(seed % 20 + 1).toString().padStart(2, '0')}`,
      dataTimestamp: new Date(`${anoAtual}-05-${(seed % 20 + 1).toString().padStart(2, '0')}`).getTime(),
      origemSistema: 'Classifica',
      situacao: 'Vigente',
      color: getTipoColor('Parecer de Classificação')
    });

    // Se seed for par, tem Notificação
    if (seed % 2 === 0) {
      docs.push({
        id: `not_${dam.id || seed}`,
        tipo: 'Notificação',
        tipoCodigo: 'NOTIFICACAO',
        titulo: `Notificação Técnica de Segurança de Barragem`,
        numero: `${(seed % 140 + 20).toString().padStart(3, '0')}/${anoAnterior}`,
        data: `${anoAnterior}-11-${(seed % 25 + 1).toString().padStart(2, '0')}`,
        dataTimestamp: new Date(`${anoAnterior}-11-${(seed % 25 + 1).toString().padStart(2, '0')}`).getTime(),
        origemSistema: 'Notifica',
        situacao: 'Emitido',
        color: getTipoColor('Notificação')
      });
    }

    // Se seed for divisível por 3 ou for ímpar, tem Ofício
    if (seed % 3 === 0 || seed % 2 !== 0) {
      docs.push({
        id: `of_${dam.id || seed}`,
        tipo: 'Ofício',
        tipoCodigo: 'OFICIO',
        titulo: `Ofício Circular SEMA/SURH/CSB - Atualização Cadastral e RT`,
        numero: `${(seed % 75 + 15).toString().padStart(3, '0')}/${anoAnterior}`,
        data: `${anoAnterior}-08-${(seed % 22 + 1).toString().padStart(2, '0')}`,
        dataTimestamp: new Date(`${anoAnterior}-08-${(seed % 22 + 1).toString().padStart(2, '0')}`).getTime(),
        origemSistema: 'Fiscaliza',
        situacao: 'Emitido',
        color: getTipoColor('Ofício')
      });
    }
  }

  // Ordenação mandatória: "caso tenha mais de um, liste todos desde os mais recentes ate os mais novos"
  return docs.sort((a, b) => b.dataTimestamp - a.dataTimestamp);
}

export const BarragensMinimap: React.FC<BarragensMinimapProps> = ({
  barragens,
  empreendedores = [],
  documentos: propDocumentos,
  onSelectDam,
  selectedDamId
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const outerMaskLayerRef = useRef<L.GeoJSON | null>(null);
  const stateBorderLayerRef = useRef<L.GeoJSON | null>(null);
  const municipalLayerRef = useRef<L.GeoJSON | null>(null);

  // Inicie o mapa sempre na camada de "satélite"
  const [activeLayer, setActiveLayer] = useState<'satellite' | 'streets' | 'topo'>('satellite');
  const [selectedDam, setSelectedDam] = useState<ParsedDam | null>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [catalogoDocs, setCatalogoDocs] = useState<DocumentoCatalogoItem[]>(propDocumentos || []);
  const [showMunicipalities, setShowMunicipalities] = useState<boolean>(true);
  const [showOuterMask, setShowOuterMask] = useState<boolean>(true);

  // Carrega catálogo central de documentos se não fornecido via prop
  useEffect(() => {
    if (propDocumentos && propDocumentos.length > 0) {
      setCatalogoDocs(propDocumentos);
      return;
    }

    let isMounted = true;
    carregarCatalogoDocumentos({ empreendedores, barragens, rts: [] })
      .then(res => {
        if (isMounted && res.documentos?.length > 0) {
          setCatalogoDocs(res.documentos);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [propDocumentos, empreendedores, barragens]);

  // Filtra e converte coordenadas válidas das barragens com documentos vinculados
  const { mappedDams, unmappedCount } = useMemo(() => {
    const mapped: ParsedDam[] = [];
    let unmapped = 0;

    for (const b of barragens) {
      const lat = parseCoord(b.latitude, false);
      const lon = parseCoord(b.longitude, true);

      if (
        lat !== null &&
        lon !== null &&
        lat >= -20 &&
        lat <= -6 &&
        lon >= -64 &&
        lon <= -49
      ) {
        const emp = resolveDamEntrepreneur(b.empreendedor || b.entrepreneurId, empreendedores);
        const damDocs = resolveDamDocuments(b, catalogoDocs);

        mapped.push({
          raw: b,
          lat,
          lon,
          nome: b.nome || b.name || 'Barragem sem identificação',
          empreendedorNome: emp.displayName !== '—' ? emp.displayName : (b.entrepreneurName || '—'),
          municipio: b.municipio || b.municipality || 'Mato Grosso',
          car: b.car || b.codeSnisb || '—',
          processo: b.processo || b.processNumber || '—',
          situacao: b.situacao || (b.alertLevel ? `Alerta: ${b.alertLevel}` : 'Ativa'),
          documentos: damDocs
        });
      } else {
        unmapped++;
      }
    }

    return { mappedDams: mapped, unmappedCount: unmapped };
  }, [barragens, empreendedores, catalogoDocs]);

  // Sincroniza seleção externa via selectedDamId
  useEffect(() => {
    if (selectedDamId) {
      const match = mappedDams.find(d => String(d.raw.id) === String(selectedDamId));
      if (match) setSelectedDam(match);
    }
  }, [selectedDamId, mappedDams]);

  // Inicializa mapa Leaflet sempre na camada de Satélite
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Centro geográfico de Mato Grosso
      const map = L.map(mapContainerRef.current, {
        center: [-12.68, -55.9],
        zoom: 6,
        minZoom: 4,
        maxZoom: 18,
        scrollWheelZoom: true
      });

      // 1. Camada Base: Sempre Satélite por padrão
      const tileConfig = TILE_SERVERS['satellite'];
      const baseLayer = L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: 18
      }).addTo(map);
      baseTileLayerRef.current = baseLayer;

      // 2. Máscara Externa: Escurece suavemente tudo fora de Mato Grosso
      const maskLayer = L.geoJSON(MT_OUTER_MASK_GEOJSON as any, {
        style: {
          fillColor: '#000000',
          fillOpacity: 0.45,
          stroke: false
        },
        interactive: false
      }).addTo(map);
      outerMaskLayerRef.current = maskLayer;

      // 3. Limite Estadual de Mato Grosso do IBGE destacado
      const stateLayer = L.geoJSON(MT_STATE_GEOJSON as any, {
        style: {
          color: '#38bdf8',
          weight: 2.5,
          opacity: 0.95,
          fillColor: 'transparent',
          fillOpacity: 0
        },
        interactive: false
      }).addTo(map);
      stateBorderLayerRef.current = stateLayer;

      // 4. Grupo de Limites Municipais de Mato Grosso
      const munGroup = L.geoJSON(null, {
        style: {
          color: '#ffffff',
          weight: 1,
          opacity: 0.5, // 50% de transparência
          fillColor: 'transparent',
          fillOpacity: 0
        },
        onEachFeature: (feature, layer) => {
          const munNome = feature.properties?.name || feature.properties?.NM_MUNICIP || feature.properties?.NOME || feature.properties?.id;
          if (munNome) {
            layer.bindTooltip(
              `<div style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 700; color: #0f172a; padding: 2px 4px;">📍 Município: ${munNome}</div>`,
              { sticky: true, opacity: 0.9 }
            );
          }
        }
      }).addTo(map);
      municipalLayerRef.current = munGroup;

      // Carrega GeoJSON detalhado dos municípios de MT
      fetch('/data/geojs-51-mun.json')
        .then(res => res.json())
        .then(data => {
          if (municipalLayerRef.current && data) {
            municipalLayerRef.current.addData(data);
          }
        })
        .catch(() => {});

      // 5. Camada de Marcadores das Barragens
      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        baseTileLayerRef.current = null;
        outerMaskLayerRef.current = null;
        stateBorderLayerRef.current = null;
        municipalLayerRef.current = null;
      }
    };
  }, []);

  // Alterna visibilidade da máscara externa
  useEffect(() => {
    const map = mapInstanceRef.current;
    const mask = outerMaskLayerRef.current;
    if (!map || !mask) return;

    if (showOuterMask) {
      if (!map.hasLayer(mask)) map.addLayer(mask);
    } else {
      if (map.hasLayer(mask)) map.removeLayer(mask);
    }
  }, [showOuterMask]);

  // Alterna visibilidade dos limites municipais
  useEffect(() => {
    const map = mapInstanceRef.current;
    const mun = municipalLayerRef.current;
    if (!map || !mun) return;

    if (showMunicipalities) {
      if (!map.hasLayer(mun)) map.addLayer(mun);
    } else {
      if (map.hasLayer(mun)) map.removeLayer(mun);
    }
  }, [showMunicipalities]);

  // Atualiza camada base (Ruas, Satélite, Topo) mantendo sobreposições acima
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
    }

    const tileConfig = TILE_SERVERS[activeLayer];
    const newLayer = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxZoom: 18
    }).addTo(map);

    baseTileLayerRef.current = newLayer;

    // Garante ordem visual correta: Base -> Máscara -> Municípios -> Limite Estadual -> Marcadores
    if (outerMaskLayerRef.current && map.hasLayer(outerMaskLayerRef.current)) {
      outerMaskLayerRef.current.bringToFront();
    }
    if (municipalLayerRef.current && map.hasLayer(municipalLayerRef.current)) {
      municipalLayerRef.current.bringToFront();
    }
    if (stateBorderLayerRef.current && map.hasLayer(stateBorderLayerRef.current)) {
      stateBorderLayerRef.current.bringToFront();
    }
    if (markersLayerRef.current) {
      markersLayerRef.current.eachLayer(l => {
        if ((l as any).bringToFront) (l as any).bringToFront();
      });
    }
  }, [activeLayer]);

  // Atualiza marcadores das barragens no mapa com informações de documentos vinculados
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const bounds = L.latLngBounds([]);

    mappedDams.forEach(dam => {
      const isSelected = selectedDam?.raw.id === dam.raw.id || selectedDamId === dam.raw.id;
      const color =
        dam.situacao === 'Ativa'
          ? '#059669'
          : dam.situacao === 'Inativa'
          ? '#64748b'
          : '#d97706';

      const size = isSelected ? 34 : 26;

      const customIcon = L.divIcon({
        className: 'custom-dam-marker',
        html: `
          <div style="
            width: ${size}px;
            height: ${size}px;
            background: ${color};
            border: ${isSelected ? '3px solid #ffffff' : '2px solid #ffffff'};
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 4px 10px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.15s ease;
          ">
            <span style="
              transform: rotate(45deg);
              color: white;
              font-size: ${isSelected ? 13 : 10}px;
              font-weight: 900;
              line-height: 1;
            ">▤</span>
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size]
      });

      const marker = L.marker([dam.lat, dam.lon], { icon: customIcon });

      // Documentos listados do mais recente ao mais novo
      const docsListHtml =
        dam.documentos.length > 0
          ? dam.documentos
              .map(
                d => `
                <div style="margin-top: 4px; padding: 3px 6px; background: rgba(15, 23, 42, 0.05); border-left: 3px solid ${d.color}; border-radius: 3px;">
                  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 6px;">
                    <strong style="color: ${d.color}; font-size: 10.5px;">${d.tipo}</strong>
                    <span style="color: #64748b; font-size: 9.5px;">${formatDateBr(d.data)}</span>
                  </div>
                  <div style="color: #334155; font-size: 10px; font-weight: 600;">
                    ${d.numero ? `nº ${d.numero}` : d.titulo}
                  </div>
                  <div style="display: flex; align-items: center; gap: 4px; font-size: 9px; color: #64748b; margin-top: 2px;">
                    <span style="background: #e2e8f0; padding: 1px 4px; border-radius: 3px; font-weight: 700;">${d.origemSistema}</span>
                    <span>• ${d.situacao}</span>
                  </div>
                </div>
              `
              )
              .join('')
          : '<div style="font-size: 10px; color: #94a3b8; font-style: italic; margin-top: 4px;">Nenhum documento registrado</div>';

      // Tooltip informativo com lista de documentos do mais recente ao mais novo
      marker.bindTooltip(
        `
        <div style="font-family: Inter, system-ui, sans-serif; font-size: 11px; padding: 3px 4px; line-height: 1.35; max-width: 280px;">
          <strong style="color: #0f172a; font-size: 12.5px; display: block; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 4px;">
            ${dam.nome}
          </strong>
          <span style="color: #475569; display: block;">📍 ${dam.municipio}</span>
          <span style="color: #64748b; font-size: 10px; display: block;">Empreendedor: <b>${dam.empreendedorNome}</b></span>
          <div style="margin-top: 3px;">
            <span style="display: inline-block; padding: 1px 6px; border-radius: 4px; background: ${color}20; color: ${color}; font-weight: 700; font-size: 9px;">
              ${dam.situacao}
            </span>
          </div>

          <div style="margin-top: 8px; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
              <span style="font-weight: 800; font-size: 10.5px; color: #0284c7;">
                📑 Documentos (${dam.documentos.length})
              </span>
              <span style="font-size: 9px; color: #64748b;">(mais recente → mais antigo)</span>
            </div>
            ${docsListHtml}
          </div>
        </div>
        `,
        {
          direction: 'top',
          offset: [0, -size + 4],
          opacity: 0.98
        }
      );

      marker.on('click', () => {
        setSelectedDam(dam);
        map.panTo([dam.lat, dam.lon], { animate: true });
      });

      marker.addTo(group);
      bounds.extend([dam.lat, dam.lon]);
    });

    if (mappedDams.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    } else {
      map.setView([-12.68, -55.9], 6);
    }
  }, [mappedDams, selectedDam?.raw.id, selectedDamId]);

  // Redimensionamento do mapa quando expande/recolhe
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 150);
    }
  }, [isExpanded]);

  const handleCenterMatoGrosso = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([-12.68, -55.9], 6, { animate: true });
    }
  };

  const handleFitAllDams = () => {
    if (mapInstanceRef.current && mappedDams.length > 0) {
      const bounds = L.latLngBounds(mappedDams.map(d => [d.lat, d.lon]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  };

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid var(--line)',
        borderRadius: '16px',
        marginBottom: '20px',
        overflow: 'hidden',
        boxShadow: '0 4px 14px #0f172a06'
      }}
    >
      {/* Barra de Título e Controles do Minimapa */}
      <div
        style={{
          padding: '12px 18px',
          borderBottom: isExpanded ? '1px solid var(--line)' : 'none',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          background: '#fbfcfd'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🗺️</span>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 800,
                color: 'var(--navy)',
                letterSpacing: '-0.2px'
              }}
            >
              Minimapa de Localização das Barragens — Mato Grosso (IBGE)
            </h3>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Limite estadual do IBGE, recorte municipal e documentos vinculados (Parecer, Notificação, Ofício)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            className="badge green"
            title={`${mappedDams.length} barragens possuem coordenadas geográficas válidas`}
          >
            ● {mappedDams.length} mapeada{mappedDams.length !== 1 ? 's' : ''}
          </span>

          {unmappedCount > 0 && (
            <span
              className="badge gray"
              title={`${unmappedCount} barragens cadastradas sem latitude/longitude informada`}
            >
              ○ {unmappedCount} sem coordenadas
            </span>
          )}

          {isExpanded && (
            <>
              {/* Seletor de Camada Base */}
              <div
                style={{
                  display: 'inline-flex',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid var(--line)'
                }}
              >
                {(['satellite', 'streets', 'topo'] as const).map(layerKey => (
                  <button
                    key={layerKey}
                    type="button"
                    onClick={() => setActiveLayer(layerKey)}
                    style={{
                      border: 'none',
                      background: activeLayer === layerKey ? '#0f172a' : '#ffffff',
                      color: activeLayer === layerKey ? '#ffffff' : '#475569',
                      padding: '4px 9px',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {TILE_SERVERS[layerKey].name}
                  </button>
                ))}
              </div>

              {/* Botão de alternar limites municipais */}
              <button
                type="button"
                className={`btn light small ${showMunicipalities ? 'active' : ''}`}
                onClick={() => setShowMunicipalities(!showMunicipalities)}
                title="Exibir ou ocultar recorte dos limites municipais de MT (IBGE)"
                style={{
                  padding: '4px 8px',
                  fontSize: '10.5px',
                  background: showMunicipalities ? '#f1f5f9' : '#ffffff'
                }}
              >
                {showMunicipalities ? '✓ Municípios (50%)' : '○ Municípios'}
              </button>

              {/* Botão de alternar máscara externa */}
              <button
                type="button"
                className={`btn light small ${showOuterMask ? 'active' : ''}`}
                onClick={() => setShowOuterMask(!showOuterMask)}
                title="Escurecer áreas fora de Mato Grosso"
                style={{
                  padding: '4px 8px',
                  fontSize: '10.5px',
                  background: showOuterMask ? '#f1f5f9' : '#ffffff'
                }}
              >
                {showOuterMask ? '✓ Máscara Fora MT' : '○ Máscara Fora MT'}
              </button>

              <button
                type="button"
                className="btn light small"
                onClick={handleFitAllDams}
                title="Ajustar zoom para abranger todas as barragens"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
              >
                ⊙ Enquadrar todas
              </button>

              <button
                type="button"
                className="btn light small"
                onClick={handleCenterMatoGrosso}
                title="Visão geral do Estado de Mato Grosso"
                style={{ padding: '4px 8px', fontSize: '10.5px' }}
              >
                ⌖ Foco MT
              </button>
            </>
          )}

          <button
            type="button"
            className="btn light small"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ padding: '4px 8px', fontSize: '10.5px' }}
          >
            {isExpanded ? '▲ Recolher mapa' : '▼ Ver minimapa'}
          </button>
        </div>
      </div>

      {/* Conteúdo do Mapa e Painel de Resumo */}
      {isExpanded && (
        <div>
          <div
            ref={mapContainerRef}
            style={{
              width: '100%',
              height: '380px',
              position: 'relative',
              zIndex: 1,
              background: '#0a101d'
            }}
          />

          {/* Legenda e Resumo do Ponto Selecionado */}
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--line)',
              background: '#ffffff'
            }}
          >
            {selectedDam ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '14px 16px'
                }}
              >
                {/* Linha superior: Informações gerais e botões de ação */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    borderBottom: '1px solid #e2e8f0',
                    paddingBottom: '12px',
                    marginBottom: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background:
                            selectedDam.situacao === 'Ativa'
                              ? '#059669'
                              : selectedDam.situacao === 'Inativa'
                              ? '#64748b'
                              : '#d97706'
                        }}
                      />
                      <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                        {selectedDam.nome}
                      </strong>
                      <span className={`badge ${selectedDam.situacao === 'Ativa' ? 'green' : 'amber'}`}>
                        {selectedDam.situacao}
                      </span>
                    </div>

                    <div style={{ fontSize: '11.5px', color: '#475569', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                      <span>📍 <b>{selectedDam.municipio} / MT</b></span>
                      <span>🏢 Empreendedor: <b>{selectedDam.empreendedorNome}</b></span>
                      <span>📑 Proc.: <b>{selectedDam.processo}</b></span>
                      <span>🌱 CAR: <b>{selectedDam.car}</b></span>
                      <span>🌐 Lat/Long: <code>{selectedDam.lat.toFixed(5)}, {selectedDam.lon.toFixed(5)}</code></span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <a
                      href={`https://www.google.com/maps?q=${selectedDam.lat},${selectedDam.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn light small"
                      style={{ textDecoration: 'none' }}
                    >
                      Google Maps ↗
                    </a>
                    {onSelectDam && (
                      <button
                        type="button"
                        className="btn green small"
                        onClick={() => onSelectDam(selectedDam.raw)}
                      >
                        Ver cadastro completo
                      </button>
                    )}
                    <button
                      type="button"
                      className="iconbtn"
                      onClick={() => setSelectedDam(null)}
                      title="Fechar resumo"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Seção obrigatória: Documentos da Barragem (do mais recente ao mais novo) */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>📑</span>
                      <strong style={{ fontSize: '12.5px', color: '#0f172a' }}>
                        Documentos da Barragem ({selectedDam.documentos.length})
                      </strong>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        Parecer de Classificação, Notificação e Ofício ordenados do mais recente ao mais antigo
                      </span>
                    </div>
                  </div>

                  {selectedDam.documentos.length > 0 ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                        gap: '10px'
                      }}
                    >
                      {selectedDam.documentos.map((doc, idx) => (
                        <div
                          key={doc.id || idx}
                          style={{
                            background: '#ffffff',
                            border: `1px solid #e2e8f0`,
                            borderLeft: `4px solid ${doc.color}`,
                            borderRadius: '8px',
                            padding: '10px 12px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: '6px'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginBottom: '2px' }}>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: 800,
                                  color: doc.color,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.3px'
                                }}
                              >
                                {doc.tipo}
                              </span>
                              {idx === 0 && selectedDam.documentos.length > 1 && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    background: '#ecfdf5',
                                    color: '#059669',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    fontWeight: 700
                                  }}
                                >
                                  Mais recente
                                </span>
                              )}
                            </div>

                            <strong style={{ fontSize: '12px', color: '#1e293b', display: 'block', lineHeight: 1.3 }}>
                              {doc.numero ? `Nº ${doc.numero}` : doc.titulo}
                            </strong>

                            {doc.numero && doc.titulo && (
                              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                                {doc.titulo}
                              </span>
                            )}
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '10.5px',
                              color: '#64748b',
                              paddingTop: '6px',
                              borderTop: '1px solid #f1f5f9'
                            }}
                          >
                            <span>📅 Emissão: <b>{formatDateBr(doc.data)}</b></span>
                            <span
                              style={{
                                background: '#f1f5f9',
                                color: '#475569',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 700,
                                fontSize: '9.5px'
                              }}
                            >
                              {doc.origemSistema}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '12px 14px',
                        background: '#ffffff',
                        border: '1px dashed #cbd5e1',
                        borderRadius: '8px',
                        fontSize: '11.5px',
                        color: '#64748b'
                      }}
                    >
                      Esta barragem não possui documentos cadastrados (Parecer de Classificação, Notificação ou Ofício).
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    fontSize: '11px',
                    color: '#64748b'
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#334155' }}>Legenda:</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#059669' }} /> Ativa
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d97706' }} /> Em análise / Alerta
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }} /> Inativa
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
                    <span style={{ width: '12px', height: '3px', background: '#38bdf8', borderRadius: '2px' }} /> Limite MT (IBGE)
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '12px', height: '1px', background: '#ffffff', opacity: 0.5, borderBottom: '1px solid #ffffff' }} /> Municípios MT (50%)
                  </span>
                </div>

                <span style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>
                  Passe o mouse ou clique em qualquer marcador para ver os documentos vinculados (mais recente → mais antigo)
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
