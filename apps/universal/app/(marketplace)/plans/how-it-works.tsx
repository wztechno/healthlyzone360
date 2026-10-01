import { HowPlansWorkScreen } from '../../../src/features/catalogue/screens/how-plans-work-screen.tsx';

/**
 * `/plans/how-it-works` — what a plan is: a balance of delivery days, the rules, a calculator.
 *
 * A static segment beside `[plan].tsx`, like `compare.tsx`: expo-router resolves a literal ahead of
 * a dynamic sibling, so `how-it-works` is never read as a plan identifier.
 */
export default function HowPlansWork() {
    return <HowPlansWorkScreen />;
}
