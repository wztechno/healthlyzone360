import type { RecipeAdminSummary } from '@healthy360/api-client/contracts';
import { Badge, Icon, IconButton, Text } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import type { KitchenId } from '@healthy360/domain-types';
import type { TFunction } from 'i18next';
import { View } from 'react-native';

import { EntityImage, MediaChip } from '../../../media/entity-image.tsx';
import { BrowseCard } from '../../../ui/browse-card.tsx';
import { CardGrid, CardGridItem } from '../../marketplace/section-header.tsx';
import { displayName, recipeRowTestId, statusShortKey, statusTone } from '../format.ts';

/**
 * The recipe list as cards — the other half of the Table / Cards switch on the recipes screen.
 *
 * The same rows, the same page, the same sort and filters as the table: this is a second drawing of
 * `list.rows`, not a second query, so switching loses nothing and the pager under it still counts
 * the same set.
 *
 * Built from the marketplace's pieces rather than new ones. `BrowseCard` is the meal card's shape —
 * a 4:3 photograph, the title with a trailing mark on its baseline, a line of meta, a tag row, and a
 * footer pinned under a rule — and `CardGrid` is the grid the menu lays it in. A recipe has no
 * photograph field on its contract; `EntityImage` resolves `recipe-<slug>` against the bundled dish
 * set and falls back to the generated pattern, so every card has a picture of some kind and the
 * ones the photo set covers show the dish.
 *
 * The card is not one pressable target. Its footer carries the row's own actions — View, Edit,
 * Archive, as the table draws them — and a card-wide press around three buttons is a nested
 * control. The title is the link that opens the editor, as a row press does, and the picture opens
 * it too without adding a tab stop (`BrowseCard`'s `mediaAction`).
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

/** The identifier after the last `#` — same reading as the table's Id column. */
function identifierFragment(identifier: string): string {
    const hash = identifier.lastIndexOf('#');
    return hash === -1 ? identifier : identifier.slice(hash + 1);
}

/**
 * `cooking_sauce` → `Cooking sauce`. The category is the kitchen's own free-text filing word, not
 * a vocabulary with translations, so this only undoes the underscore spelling it is stored in.
 */
function humaniseCategory(category: string | null): string | null {
    if (category === null) return null;
    const words = category.replace(/_/g, ' ').trim();
    return words === '' ? null : words.charAt(0).toLocaleUpperCase() + words.slice(1);
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
                const category = humaniseCategory(row.recipeCategory ?? row.sourceKind);
                const meta = [kitchenName(row.kitchenId), category]
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
                                    assetId={`recipe-${row.slug}`}
                                    variant="card"
                                    seed={row.slug}
                                    label={t('kitchen:recipes.imageLabel', { recipe: name.value })}
                                    aspect="card"
                                    flush
                                    overlayStart={
                                        <MediaChip
                                            label={identifierFragment(row.reference ?? row.slug)}
                                        />
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
                            {name.isFallback ? (
                                <View className="flex-row">
                                    <Badge
                                        testID={`${cardID}-missing-arabic`}
                                        tone="warning"
                                        icon="languages"
                                        label={t('kitchen:list.missingArabic')}
                                    />
                                </View>
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
