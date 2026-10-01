/**
 * The signed-in order area, as one lazily-loaded chunk — the same barrel-per-area rule the account
 * screens follow (`shell/lazy-screen.tsx` says why one chunk per area beats one per screen).
 */
export { CustomerOrderScreen } from './customer-order-screen.tsx';
export type { CustomerOrderScreenProps } from './customer-order-screen.tsx';
