import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NewRequestInput } from '@two-cents/shared';

import { RequestForm } from './RequestForm';

describe('RequestForm', () => {
  it('renders with one item row by default in new mode', () => {
    render(<RequestForm mode="new" onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByTestId('item-row-0')).toBeInTheDocument();
    expect(screen.queryByTestId('item-row-1')).not.toBeInTheDocument();
  });

  it('add-item button adds a second row', async () => {
    const user = userEvent.setup();
    render(<RequestForm mode="new" onSubmit={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole('button', { name: /add item/i }));

    expect(screen.getByTestId('item-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('item-row-1')).toBeInTheDocument();
  });

  it('remove-item button is disabled when only 1 item, enabled with 2+', async () => {
    const user = userEvent.setup();
    render(<RequestForm mode="new" onSubmit={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByRole('button', { name: /remove item 1/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /add item/i }));

    expect(screen.getByRole('button', { name: /remove item 1/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /remove item 2/i })).toBeEnabled();
  });

  it('submits with integer priceCents converted from dollars', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RequestForm mode="new" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/^title$/i), 'A bundle');
    await user.type(screen.getByLabelText(/^item title$/i), 'Widget');
    await user.type(screen.getByLabelText(/^url$/i), 'https://example.com/widget');
    const price = screen.getByLabelText(/^price$/i);
    await user.clear(price);
    await user.type(price, '12.34');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submitted = onSubmit.mock.calls[0]![0] as NewRequestInput;
    expect(submitted.title).toBe('A bundle');
    expect(submitted.currency).toBe('USD');
    expect(submitted.buyerSeriousness).toBe('really_want');
    expect(submitted.items).toHaveLength(1);
    const item = submitted.items[0]!;
    expect(item.title).toBe('Widget');
    expect(item.url).toBe('https://example.com/widget');
    expect(item.priceCents).toBe(1234);
    expect(Number.isInteger(item.priceCents)).toBe(true);
    expect(item.id).toBeUndefined();
  });

  it('does not call onSubmit when title is empty (validation fails)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RequestForm mode="new" onSubmit={onSubmit} />);

    // Fill item fields but leave title empty
    await user.type(screen.getByLabelText(/^item title$/i), 'Widget');
    await user.type(screen.getByLabelText(/^url$/i), 'https://example.com/widget');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    // Give RHF a tick to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
  });

  it('selecting a seriousness button updates the submitted value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RequestForm mode="new" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /^need$/i }));

    await user.type(screen.getByLabelText(/^title$/i), 'X');
    await user.type(screen.getByLabelText(/^item title$/i), 'Y');
    await user.type(screen.getByLabelText(/^url$/i), 'https://example.com');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const submitted = onSubmit.mock.calls[0]![0] as NewRequestInput;
    expect(submitted.buyerSeriousness).toBe('need');
  });

  it('edit mode preserves item ids and uses "Save changes" submit label', () => {
    render(
      <RequestForm
        mode="edit"
        defaultValues={{
          title: 'Existing',
          description: '',
          buyerSeriousness: 'need',
          currency: 'USD',
          items: [
            {
              id: 7,
              title: 'Item one',
              url: 'https://example.com/one',
              priceCents: 500,
              notes: '',
              imageKey: '',
            },
          ],
        }}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect((screen.getByLabelText(/^title$/i) as HTMLInputElement).value).toBe(
      'Existing',
    );
    expect((screen.getByLabelText(/^price$/i) as HTMLInputElement).value).toBe('5');
  });
});
