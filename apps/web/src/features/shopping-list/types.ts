import type { PendingItem } from './api';

export type PendingViewProps = {
  pendingItems: PendingItem[];
  pendingLoading: boolean;
  pendingError: string;
  actionError: string;
  notice: string;
  busyProductId: string | null;
  onRetryPending: () => void;
  onTogglePending: (productId: string) => Promise<void>;
};
