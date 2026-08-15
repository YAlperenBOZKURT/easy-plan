import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { installGlobalErrorHandlers, logger } from './lib/logger.ts';
import './styles.css';

installGlobalErrorHandlers();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => logger.error('query_failed', error, { queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      logger.error('mutation_failed', error, { mutationKey: mutation.options.mutationKey }),
  }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
