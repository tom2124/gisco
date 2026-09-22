import React from 'react';
import { STATE_SORT_OPTIONS, type SortMode, type SortOption } from '../utils/sort';

interface SortSelectProps {
  value: SortMode;
  onChange: (mode: SortMode) => void;
  options?: readonly SortOption[];
}

export const SortSelect: React.FC<SortSelectProps> = ({
  value,
  onChange,
  options = STATE_SORT_OPTIONS,
}) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '0.85rem',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
    }}
  >
    Sort
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortMode)}
      style={{ width: 'auto' }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);

export default SortSelect;
