import { useLocalSearchParams } from 'expo-router';

import { DENIAL_REASONS } from '@healthy360/permissions';
import type { DenialReason } from '@healthy360/permissions';

import { ForbiddenScreen } from '../src/screens/forbidden-screen.tsx';

function toReason(value: unknown): DenialReason {
    return typeof value === 'string' && (DENIAL_REASONS as readonly string[]).includes(value)
        ? (value as DenialReason)
        : 'permission_missing';
}

/**
 * `/forbidden?reason=…` — the directly navigable refusal page.
 *
 * Guards normally render `ForbiddenScreen` *in place* so the refused URL is preserved; this route
 * exists for the cases that genuinely have nowhere else to go, and for deep links from outside.
 */
export default function Forbidden() {
    const params = useLocalSearchParams<{ reason?: string }>();
    return <ForbiddenScreen reason={toReason(params.reason)} />;
}
