/**
 * The platform console's screens, as one lazily-loaded module.
 *
 * The rule the kitchen workspace's barrel states, applied: **one chunk per route area, not one per
 * screen.** An operator opening the console lists kitchens, opens one, and often creates one in the
 * same sitting; splitting those three into three chunks would put a network round trip on the
 * critical path of each click for no benefit — the code is out of the entry bundle either way.
 */
export { CreateKitchenScreen } from './create-kitchen-screen.tsx';
export { PlatformKitchenDetailScreen } from './kitchen-detail-screen.tsx';
export { PlatformKitchensScreen } from './kitchens-screen.tsx';
