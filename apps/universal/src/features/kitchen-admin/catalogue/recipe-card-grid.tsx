import type { RecipeAdminSummary } from '@healthy360/api-client/contracts';
import { Badge, Icon, IconButton, Inline, Text } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { KitchenId } from '@healthy360/domain-types';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { EntityImage, MediaChip } from '../../../media/entity-image.tsx';
import { BrowseCard } from '../../../ui/browse-card.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { displayName, recipeRowTestId, statusShortKey, statusTone } from '../format.ts';
import { kindsLabel, recipeCategoryLabel, recipeHandle, recipePhotoId } from './recipe-columns.tsx';

/**
 * The recipe book as cards — the other half of the Table / Cards switch on the recipes screen.
 *
 * The same rows, the same page, the same sort and filters as the table: this is a second drawing of
 * `list.rows`, not a second query, so switching loses nothing and the pager under it still counts
 * the same set. The words come from the table's own helpers in `recipe-columns.tsx` — the handle,
 * the kinds, the filing word — so a card and a row can never name one recipe two ways.
 *
 * Built from the marketplace's pieces rather than new ones. `BrowseCard` is the meal card's shape —
 * a 4:3 photograph, the title with a trailing mark on its baseline, a line of meta, a tag row, and a
 * footer pinned under a rule — and `CardGrid` is the grid the menu lays it in. The photograph is the
 * seller's when something sells the recipe, else `recipe-<slug>` against the bundled dish set, and
 * `EntityImage` falls back to the generated pattern, so every card has a picture of some kind.
 *
 * The photograph carries two chips: the handle at its leading top corner, and — for a reader who can
 * see what sells the recipe — its kinds at the trailing bottom one, "Sauce" or "Meal · Sauce". The
 * kind is a chip rather than a meta word because on the All tab it is what tells one card from the
 * next, and the meta line is already the kitchen and the filing word.
 *
 * The card is not one pressable target. Its footer carries the row's own actions — View, Edit,
 * Withdraw, Archive, as the table draws them — and a card-wide press around several buttons is a
 * nested control. The title is the link that opens the editor, as a row press does, and the
 * picture opens it too without adding a tab stop (`BrowseCard`'s `mediaAction`).
 */

export interface RecipeCardGridProps {
    readonly rows: readonly RecipeAdminSummary[];
    readonly t: TFunction;
    readonly locale: string;
    readonly kitchenName: (kitchenId: KitchenId) => string;
    readonly onOpen: (row: RecipeAdminSummary) => void;
    readonly rowActions: (row: RecipeAdminSummary) => readonly MenuItem[];
    readonly rowActionsLabel: string;
    readonly testID: string;
}

/** How many allergen tags a card draws before the rest collapse into `+N`. */
const MAX_ALLERGEN_TAGS = 4;

export function RecipeCardGrid({
    rows,
    t,
    locale,
    kitchenName,
    onOpen,
    rowActions,
    rowActionsLabel,
    testID,
}: RecipeCardGridProps) {
    return (
        <CardGrid testID={testID}>
            {rows.map((row) => {
                const id = String(row.id);
                const cardID = `${recipeRowTestId(id)}-card`;
                const name = displayName(row.name, locale);
                const kinds = kindsLabel(row, t);
                const meta = [
                    kitchenName(row.kitchenId),
                    recipeCategoryLabel(row.recipeCategory, t),
                ]
                    .filter((part): part is string => part !== null && part !== '')
                    .join(' · ');
                const open = () => {
                    onOpen(row);
                };

                return (
                    <CardGridItem key={id}>
                        <BrowseCard
                            testID={cardID}
                            className="grow"
                            titleAction={{
                                onPress: open,
                                accessibilityLabel: name.value,
                                testID: `${cardID}-open`,
                            }}
                            mediaAction={open}
                            media={
                                <EntityImage
                                    testID={`${cardID}-image`}
                                    assetId={recipePhotoId(row)}
                                    variant="card"
                                    seed={row.slug}
                                    label={t('kitchen:recipes.imageLabel', { recipe: name.value })}
                                    aspect="card"
                                    flush
                                    overlayStart={<MediaChip label={recipeHandle(row)} />}
                                    overlayEnd={
                                        kinds === null ? undefined : (
                                            <MediaChip testID={`${cardID}-kind`} label={kinds} />
                                        )
                                    }
                                />
                            }
                            title={name.value}
                            trailing={
                                <Badge
                                    testID={`${cardID}-status`}
                                    tone={statusTone(row.meta.status)}
                                    icon={row.meta.status === 'published' ? null : undefined}
                                    label={t(statusShortKey(row.meta.status))}
                                />
                            }
                            meta={meta}
                            metaLines={1}
                            tags={
                                row.allergenCodes.length === 0
                                    ? undefined
                                    : row.allergenCodes.map((code) => ({
                                          key: code,
                                          label: code,
                                          tone: 'warning' as const,
                                          icon: null,
                                      }))
                            }
                            maxTags={MAX_ALLERGEN_TAGS}
                            footer={
                                <View className="flex-row items-center justify-between gap-2">
                                    <Text
                                        testID={`${cardID}-version`}
                                        variant="caption"
                                        tone="secondary"
                                        numberOfLines={1}
                                    >
                                        {t('kitchen:recipes.versionNumber', {
                                            number: row.currentVersionNumber,
                                        })}
                                    </Text>
                                    <View
                                        accessibilityLabel={rowActionsLabel}
                                        aria-label={rowActionsLabel}
                                        className="flex-row items-center gap-hair"
                                    >
                                        {rowActions(row).map((action) => (
                                            <IconButton
                                                key={action.key}
                                                label={action.label}
                                                variant="ghost"
                                                size="sm"
                                                {...(action.tone === undefined
                                                    ? {}
                                                    : { tone: action.tone })}
                                                {...(action.disabled === undefined
                                                    ? {}
                                                    : { disabled: action.disabled })}
                                                icon={
                                                    <Icon name={action.icon ?? 'more'} size="sm" />
                                                }
                                                onPress={action.onSelect}
                                                testID={
                                                    action.testID ??
                                                    `${cardID}-action-${action.key}`
                                                }
                                            />
                                        ))}
                                    </View>
                                </View>
                            }
                        >
                            {name.isFallback || row.lineCount === 0 ? (
                                <Inline space="xs">
                                    {name.isFallback ? (
                                        <Badge
                                            testID={`${cardID}-missing-arabic`}
                                            tone="warning"
                                            icon="languages"
                                            label={t('kitchen:list.missingArabic')}
                                        />
                                    ) : null}
                                    {row.lineCount === 0 ? (
                                        <Badge
                                            testID={`${cardID}-not-formulated`}
                                            tone="warning"
                                            label={t('kitchen:recipes.notFormulated')}
                                        />
                                    ) : null}
                                </Inline>
                            ) : null}
                            {row.allergenCodes.length === 0 ? (
                                <Text
                                    testID={`${cardID}-allergens-none`}
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {t('kitchen:recipes.noAllergens')}
                                </Text>
                            ) : null}
                        </BrowseCard>
                    </CardGridItem>
                );
            })}
        </CardGrid>
    );
}
