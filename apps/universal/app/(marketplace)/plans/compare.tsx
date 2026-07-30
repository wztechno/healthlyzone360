import { PlanComparisonScreen } from '../../../src/features/catalogue/screens/plan-comparison-screen.tsx';

/**
 * `/plans/compare` — two or three plans side by side.
 *
 * A static segment sitting beside `[plan].tsx`: expo-router resolves a literal ahead of a dynamic
 * sibling, so `compare` can never be read as a plan identifier.
 */
export default function PlanComparison() {
    return <PlanComparisonScreen />;
}
