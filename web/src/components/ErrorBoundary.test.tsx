import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary.tsx';
import { logger } from '../lib/logger.ts';

function BrokenComponent(): never {
  throw new Error('render failed');
}

it('render hatasını yakalar, güvenli ekranı gösterir ve loglar', () => {
  const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const reactError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  render(
    <ErrorBoundary>
      <BrokenComponent />
    </ErrorBoundary>,
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Beklenmeyen bir sorun oluştu');
  expect(screen.getByRole('button', { name: 'Sayfayı yenile' })).toBeEnabled();
  expect(log).toHaveBeenCalledWith('react_render_error', expect.any(Error), expect.any(Object));
  reactError.mockRestore();
});
