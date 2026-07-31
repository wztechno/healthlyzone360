/**
 * The commerce surfaces: basket, one-off checkout, subscription configurator and subscription
 * management.
 *
 * The pure modules (`dates`, `delivery`, `address`, `configurator`, `warnings`) carry every rule
 * worth testing without a rendered tree; the screens compose them. Nothing here imports a fixture,
 * and nothing here takes a payment.
 */

export { CartScreen } from './screens/cart-screen.tsx';
export { CheckoutScreen } from './screens/checkout-screen.tsx';
export { SubscriptionConfiguratorScreen } from './screens/subscription-configurator-screen.tsx';
export type { SubscriptionConfiguratorScreenProps } from './screens/subscription-configurator-screen.tsx';
export { SubscriptionsScreen } from './screens/subscriptions-screen.tsx';
export { SubscriptionDetailScreen } from './screens/subscription-detail-screen.tsx';
export type { SubscriptionDetailScreenProps } from './screens/subscription-detail-screen.tsx';

export { AddressForm } from './address-form.tsx';
export type { AddressFormProps } from './address-form.tsx';
export { PriceSummary } from './price-summary.tsx';
export type { PriceRow, PriceSummaryProps } from './price-summary.tsx';
export {
    SubscriptionStateBadge,
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from './state-badge.tsx';
