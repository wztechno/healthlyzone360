import {
    Badge,
    Button,
    Card,
    EmptyState,
    Heading,
    Inline,
    ListItem,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { availableWorkspaceAreas } from '../navigation/items.ts';
import { useAccessState, useSession } from '../session/session-provider.tsx';

/**
 * Workspace selector.
 *
 * The list is produced by running each area through **the same kernel the route layouts use**, so
 * an entry appears only when its gate would actually open. That is why nothing is greyed out here:
 * a destination that refuses on arrival is a worse experience than one that was never offered, and
 * the kernel already knows the difference.
 */
export function WorkspaceSelectorScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const accessState = useAccessState();
    const { me } = useSession();

    const areas = availableWorkspaceAreas(accessState);
    const context = me?.activeContext ?? null;
    const membership = me?.memberships.find((candidate) => candidate.id === context?.membershipId);
    const organisationName = membership?.organisation.name ?? t('auth:profile.noContext');
    const branch = membership?.branches.find((candidate) => candidate.id === context?.branchId);

    return (
        <Stack testID="workspace-selector-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="workspace-selector-title">
                    {t('access:workspaceSelector.title')}
                </Heading>
                <Text tone="secondary">
                    {t('access:workspaceSelector.subtitle', { organisation: organisationName })}
                </Text>
                <Inline space="xs">
                    <Badge testID="workspace-organisation" tone="brand" label={organisationName} />
                    {branch === undefined ? null : (
                        <Badge testID="workspace-branch" tone="info" label={branch.name} />
                    )}
                </Inline>
            </Stack>

            {areas.length === 0 ? (
                <EmptyState
                    testID="workspace-selector-empty"
                    title={t('access:workspaceSelector.empty')}
                    body={t('access:workspaceSelector.emptyBody')}
                    actions={
                        <Button
                            testID="workspace-selector-switch"
                            label={t('auth:workspace.switchOrganisation')}
                            onPress={() => {
                                router.replace('/select-organisation');
                            }}
                        />
                    }
                />
            ) : (
                <Card padding="sm">
                    <Stack space="xs">
                        {areas.map((option) => (
                            <ListItem
                                key={option.area}
                                testID={`workspace-area-${option.area}`}
                                title={t(`access:area.${option.area}`)}
                                accessibilityLabel={t('access:workspaceSelector.open', {
                                    area: t(`access:area.${option.area}`),
                                })}
                                chevron
                                onPress={() => {
                                    router.push(option.href as never);
                                }}
                            />
                        ))}
                    </Stack>
                </Card>
            )}

            <Inline space="sm">
                <Button
                    testID="workspace-switch-organisation"
                    variant="secondary"
                    size="sm"
                    label={t('auth:workspace.switchOrganisation')}
                    onPress={() => {
                        router.push('/select-organisation');
                    }}
                />
                {membership !== undefined && membership.branches.length > 1 ? (
                    <Button
                        testID="workspace-switch-branch"
                        variant="secondary"
                        size="sm"
                        label={t('auth:workspace.switchBranch')}
                        onPress={() => {
                            router.push('/select-branch');
                        }}
                    />
                ) : null}
            </Inline>
        </Stack>
    );
}
