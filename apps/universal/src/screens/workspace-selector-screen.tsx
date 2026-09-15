import {
    Badge,
    Button,
    Card,
    EmptyState,
    Heading,
    Icon,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AREA_ICONS, availableWorkspaceAreas } from '../navigation/items.ts';
import { useAccessState, useSession } from '../session/session-provider.tsx';

/**
 * Workspace selector.
 *
 * The list is produced by running each area through **the same kernel the route layouts use**, so
 * an entry appears only when its gate would actually open. That is why nothing is greyed out here:
 * a destination that refuses on arrival is a worse experience than one that was never offered, and
 * the kernel already knows the difference.
 *
 * ## One panel, centred, at a size that does not move
 *
 * The choice is the whole page, so it is drawn as a single centred panel rather than as content
 * flowing down a column: heading above it, the destinations inside it, and the context switches
 * under a rule at its foot. Everything on the page shares one centre line.
 *
 * The panel's width and the tiles inside it are **fixed**, and that is the point rather than an
 * accident. How many areas a person's role grants is a property of their role, and it must not
 * change what a tile *is* — an owner with five destinations and a buyer with two should recognise
 * the same page. So the tiles keep their size and centre themselves inside a panel that also keeps
 * its size; only how many sit on a row changes.
 */

/**
 * Sizes as style objects, not Tailwind classes, and the reason is not preference.
 *
 * `w-[240px]`-style arbitrary values only exist in the stylesheet if Tailwind saw them when it last
 * scanned the source. A *newly written* arbitrary value is therefore silently dropped by a Metro
 * process still serving its cached CSS — the class is on the element and means nothing — which is
 * exactly how these tiles came to size themselves to their labels instead of to the number written
 * here. A plain style object is applied by the layout engine itself, so it cannot be cache-dropped
 * and needs no rebuild to take effect.
 *
 * `PANEL_WIDTH` is sized to hold five tiles on one row — `5 x 170 + 4 x 12` gutters is 898, inside
 * 960 less the panel's own 24px padding. `maxWidth: '100%'` is what keeps that honest on a phone,
 * where a fixed 960 would otherwise run off the side of the screen.
 */
const PANEL_WIDTH = 960;
const TILE_WIDTH = 170;
const TILE_HEIGHT = 130;

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

    const contextSwitches = (
        <Inline space="sm" justify="center" wrap>
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
    );

    return (
        <Stack testID="workspace-selector-screen" space="lg">
            <Stack space="xs" align="center">
                <Heading level={1} testID="workspace-selector-title" align="center">
                    {t('access:workspaceSelector.title')}
                </Heading>
                <Text tone="secondary" align="center">
                    {t('access:workspaceSelector.subtitle', { organisation: organisationName })}
                </Text>
                <Inline space="xs" justify="center" wrap>
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
                <View style={{ width: PANEL_WIDTH, maxWidth: '100%', alignSelf: 'center' }}>
                    <Card testID="workspace-area-panel" padding="lg">
                        <Stack space="md">
                            {/*
                             * `flex-wrap` with `justify-center`, and not the `grid` utilities the
                             * kitchen hub uses further down its own file: `grid` is a web-only
                             * escape hatch, and unlike that hub this screen is reached on iOS and
                             * Android too. Wrapping also gives the centring for free — a row that
                             * cannot fit the next tile starts a new one, and each row centres on
                             * its own, so two destinations sit together in the middle rather than
                             * stranded at the leading edge.
                             */}
                            <View
                                className="flex-row flex-wrap justify-center gap-3"
                                testID="workspace-area-grid"
                            >
                                {areas.map((option) => {
                                    const name = t(`access:area.${option.area}`);
                                    return (
                                        <View
                                            key={option.area}
                                            style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}
                                        >
                                            {/*
                                             * `flex-1` fills the fixed box above rather than
                                             * `h-full`, which `card.tsx` warns against: a
                                             * percentage height resolved against a ScrollView's
                                             * grown content is not the height you meant.
                                             */}
                                            <Card
                                                testID={`workspace-area-${option.area}`}
                                                interactive
                                                padding="md"
                                                className="flex-1 items-center justify-center"
                                                accessibilityLabel={t(
                                                    'access:workspaceSelector.open',
                                                    { area: name },
                                                )}
                                                onPress={() => {
                                                    router.push(option.href as never);
                                                }}
                                            >
                                                <Stack space="xs" align="center">
                                                    {/*
                                                     * Unlabelled on purpose. The name below is the
                                                     * accessible content; a labelled icon would
                                                     * have the tile announce the same area twice,
                                                     * once as a glyph and once as a word.
                                                     */}
                                                    <Icon
                                                        name={AREA_ICONS[option.area]}
                                                        size="lg"
                                                        className="text-brand-600"
                                                    />
                                                    <Text variant="bodyStrong" align="center">
                                                        {name}
                                                    </Text>
                                                </Stack>
                                            </Card>
                                        </View>
                                    );
                                })}
                            </View>

                            {/*
                             * A rule, then the context switches. Changing organisation or branch is
                             * a different kind of action from picking a destination — it changes
                             * what the destinations *are* — so it is separated rather than left to
                             * read as a sixth tile.
                             */}
                            <View className="self-stretch border-t border-stroke-subtle" />
                            {contextSwitches}
                        </Stack>
                    </Card>
                </View>
            )}
        </Stack>
    );
}
