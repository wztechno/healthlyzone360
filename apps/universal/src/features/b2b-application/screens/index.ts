/**
 * The B2B application area, as one lazily-loaded chunk.
 *
 * Every route under `(business)` imports *this* barrel rather than its own screen module, so Metro
 * emits one chunk for the whole area — see `shell/lazy-screen.tsx` for why one chunk per area beats
 * one per screen. An applicant moving from the entry screen through five wizard steps to the
 * agreement pays one fetch instead of seven, each of which would otherwise sit on the critical path
 * of a tap.
 */
export { ApplyAgreementScreen } from './apply-agreement-screen.tsx';
export { ApplyEntryScreen } from './apply-entry-screen.tsx';
export { ApplyProvisioningScreen } from './apply-provisioning-screen.tsx';
export { ApplyStatusScreen } from './apply-status-screen.tsx';
export { ApplyStepScreen } from './apply-step-screen.tsx';
export type { ApplyStepScreenProps } from './apply-step-screen.tsx';
