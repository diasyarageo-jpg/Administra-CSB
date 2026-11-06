import React from 'react';

export type PageSizeOption = 10 | 20 | 30 | 50 | 'all';

interface PaginationBarProps {
  totalItems: number;
  currentPage: number;
  pageSize: PageSizeOption;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSizeOption) => void;
}

export function paginateList<T>(
  items: T[],
  currentPage: number,
  pageSize: PageSizeOption
): {
  pagedItems: T[];
  totalPages: number;
  safePage: number;
  startIndex: number;
  endIndex: number;
} {
  const total = items.length;
  if (pageSize === 'all' || total === 0) {
    return {
      pagedItems: items,
      totalPages: 1,
      safePage: 1,
      startIndex: total === 0 ? 0 : 1,
      endIndex: total
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);

  return {
    pagedItems: items.slice(start, end),
    totalPages,
    safePage,
    startIndex: start + 1,
    endIndex: end
  };
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange
}) => {
  const { totalPages, safePage, startIndex, endIndex } = paginateList(
    Array.from({ length: totalItems }),
    currentPage,
    pageSize
  );

  return (
    <div className="pagination-bar">
      <div className="pagination-info">
        {totalItems === 0
          ? '0 registros'
          : pageSize === 'all'
          ? `Exibindo todos os ${totalItems} registros`
          : `Exibindo ${startIndex}–${endIndex} de ${totalItems} registros`}
      </div>

      <div className="pagination-controls">
        <label className="pagination-size-label">
          <span>Itens por página:</span>
          <select
            className="select pagination-select"
            value={String(pageSize)}
            onChange={e => {
              const val = e.target.value;
              onPageSizeChange(val === 'all' ? 'all' : (Number(val) as PageSizeOption));
              onPageChange(1);
            }}
            aria-label="Itens por página"
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30">30</option>
            <option value="50">50</option>
            <option value="all">Todos</option>
          </select>
        </label>

        {pageSize !== 'all' && totalPages > 1 && (
          <div className="pagination-pages">
            <button
              type="button"
              className="iconbtn"
              disabled={safePage <= 1}
              onClick={() => onPageChange(safePage - 1)}
            >
              ‹ Anterior
            </button>
            <span className="pagination-page-indicator">
              Página <b>{safePage}</b> de <b>{totalPages}</b>
            </span>
            <button
              type="button"
              className="iconbtn"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(safePage + 1)}
            >
              Próxima ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
