import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { type Column } from './DataTable';

type Row = { id: number; name: string; count: number };

const sample: Row[] = [
  { id: 1, name: 'Alpha', count: 3 },
  { id: 2, name: 'Beta', count: 7 },
];

const cols: Column<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name },
  { key: 'count', header: 'Count', render: (r) => String(r.count) },
];

describe('DataTable', () => {
  it('renders headers and rows', () => {
    render(<DataTable<Row> rows={sample} columns={cols} rowKey={(r) => r.id} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows empty state when rows is empty', () => {
    render(<DataTable<Row> rows={[]} columns={cols} rowKey={(r) => r.id} />);
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('shows loading state when isLoading', () => {
    render(<DataTable<Row> rows={[]} columns={cols} rowKey={(r) => r.id} isLoading />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <DataTable<Row>
        rows={sample}
        columns={cols}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Alpha'));
    expect(onRowClick).toHaveBeenCalledWith(sample[0]);
  });
});
