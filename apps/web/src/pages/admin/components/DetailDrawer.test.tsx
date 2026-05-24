import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailDrawer from './DetailDrawer';

describe('DetailDrawer', () => {
  it('renders nothing when not open', () => {
    render(
      <DetailDrawer open={false} onClose={() => {}} title="X">
        <div>Body</div>
      </DetailDrawer>,
    );
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders title and body when open', () => {
    render(
      <DetailDrawer open onClose={() => {}} title="Profile">
        <div>Body content</div>
      </DetailDrawer>,
    );
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <DetailDrawer open onClose={onClose} title="X">
        <div>Body</div>
      </DetailDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
