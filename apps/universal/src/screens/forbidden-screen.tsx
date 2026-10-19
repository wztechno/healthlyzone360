import { Badge, Button, Card, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { ROUTE_PATHS, modeAllows } from '@healthy360/permissions';
import type { AccessState, DenialReason } from '@healthy360/permissions';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { availableWorkspaceAreas } from '../navigation/items.ts';
import { useGoBackOr } from '../navigation/use-return-to.ts';
import { useAccessState } from '../session/session-provider.tsx';

/**
 * Whether the person has anywhere to go but the shop: a staff workspace they may open, or an
 * organisation membership — which is what makes "choose a different organisation" mean something
 * even while every workspace in this one is closed to them.
 */
export function hasStaffExits(state: AccessState): boolean {
    return (
        state.hasActiveMembership ||
        availableWorkspaceAreas(state).some((option) => option.area !== 'customer')
    );
}

/** Where a shopper's way out leads: the marketplace home where this build has one, else `/`. */
export function shopperHome(state: AccessState): string {
    return modeAllows(state.mode, 'public') ? ROUTE_PATHS.customerHome : '/';
}

export interface ForbiddenScreenProps {
    readonly reason: DenialReason;
    /** Entitlement or permission keys that were absent — shown so the refusal is actionable. */
    readonly missing?: readonly string[] | undefined;
    readonly testID?: string | undefined;
}

/**
 * The single refusal screen.
 *
 * It renders **in place** of the guarded content rather than redirecting, so the URL the user
 * actually asked for is still in the address bar. That is what makes a deep link into an
 * unpermitted area reproducible in a test and describable in a support conversation.
 *
 * Every denial reason maps to a translated title and body (`access:denial.<reason>`); the reason
 * string itself is never shown to a person.
 *
 * ## The way out depends on who is refused
 *
 * Staff get the staff exits: their workspace, another organisation. A shopper used to get the same
 * two (AUTH-18) — "Go to your workspace" opened the staff workspace selector, and the organisation
 * picker spun and then sent them to the marketplace. A shopper's ways out are Back, to wherever
 * they came from, and the marketplace home.
 */
export function ForbiddenScreen({
    reason,
    missing = [],
    testID = 'forbidden',
}: ForbiddenScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const goBackOr = useGoBackOr();
    const accessState = useAccessState();
    const staff = hasStaffExits(accessState);
    const home = shopperHome(accessState);

    return (
        <Stack testID={testID} space="lg" className="p-4">
            <Card tone="danger" padding="lg">
                <Stack space="sm">
                    <Heading level={1} testID={`${testID}-title`}>
                        {t('access:forbidden.title')}
                    </Heading>
                    <Heading level={2} testID={`${testID}-reason-title`}>
                        {t(`access:denial.${reason}.title`)}
                    </Heading>
                    <Text testID={`${testID}-reason-body`} tone="secondary">
                        {t(`access:denial.${reason}.body`)}
                    </Text>
                    <Inline space="xs">
                        <Text variant="caption" tone="secondary">
                            {t('access:forbidden.reasonLabel')}
                        </Text>
                        <Badge testID={`${testID}-reason-code`} tone="danger" label={reason} />
                    </Inline>

                    {missing.length === 0 ? null : (
                        <Inline space="xs">
                            <Text variant="caption" tone="secondary">
                                {t('access:forbidden.missingLabel')}
                            </Text>
                            {missing.map((key) => (
                                <Badge
                                    key={key}
                                    testID={`${testID}-missing-${key}`}
                                    tone="warning"
                                    label={key}
                                />
                            ))}
                        </Inline>
                    )}
                </Stack>
            </Card>

            {staff ? (
                <Inline space="sm">
                    <Button
                        testID={`${testID}-workspace`}
                        label={t('access:forbidden.backToWorkspace')}
                        onPress={() => {
                            router.replace(ROUTE_PATHS.workspace as never);
                        }}
                    />
                    <Button
                        testID={`${testID}-switch-organisation`}
                        variant="secondary"
                        label={t('access:forbidden.switchOrganisation')}
                        onPress={() => {
                            router.replace(ROUTE_PATHS.selectOrganisation as never);
                        }}
                    />
                </Inline>
            ) : (
                <Inline space="sm">
                    <Button
                        testID={`${testID}-home`}
                        label={
                            home === '/'
                                ? t('access:notFound.home')
                                : t('access:forbidden.toDiscover')
                        }
                        onPress={() => {
                            router.replace(home as never);
                        }}
                    />
                    <Button
                        testID={`${testID}-back`}
                        variant="secondary"
                        label={t('common:action.back')}
                        onPress={() => {
                            goBackOr(home);
                        }}
                    />
                </Inline>
            )}
        </Stack>
    );
}
