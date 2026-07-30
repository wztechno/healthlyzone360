import {
    Badge,
    Callout,
    Chip,
    Drawer,
    ImagePlaceholder,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { formatMoney, nutrientValue } from './format.ts';

/**
 * The in-place meal detail.
 *
 * ## Why a drawer and not a route
 *
 * `/meals/{meal}` — the full record, with the nutrition-facts panel, provenance, ingredients,
 * preparation steps, portion control and ordering — is the catalogue wave's screen. Until it
 * exists, a menu card has three possible behaviours and only one of them is defensible:
 *
 * * link to `/meals/{meal}` anyway — the static export's shell fallback renders "not found", which
 *   is a dead link dressed as a feature;
 * * render the card with no press behaviour at all — a dead control, banned by lint and by the
 *   prompt;
 * * answer in place with the data the listing genuinely carries, and say what is still missing.
 *
 * This is the third. Everything shown here comes from `MarketplaceMeal`, which the menu query has
 * already fetched, so the drawer is honest about being a summary rather than pretending to be the
 * record. The handoff note is deliberate and is meant to be deleted by the catalogue wave, which
 * replaces this component's body with a link.
 *
 * The nutrition figures carry their own provenance line and the standing medical disclaimer, for
 * the same reason they do everywhere else: they are synthetic, and they are an estimate.
 */
export interface MealDetailDrawerProps {
    readonly meal: MarketplaceMeal | null;
    readonly onClose: () => void;
    readonly testID?: string | undefined;
}

export function MealDetailDrawer({
    meal,
    onClose,
    testID = 'meal-detail-drawer',
}: MealDetailDrawerProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Drawer
            testID={testID}
            open={meal !== null}
            onClose={onClose}
            placement="end"
            title={meal?.name ?? t('marketplace:menu.detailTitle')}
        >
            {meal === null ? null : (
                <Stack space="md">
                    <ImagePlaceholder
                        testID={`${testID}-image`}
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        aspect="wide"
                    />

                    <Text tone="secondary">{meal.description}</Text>

                    <Inline space="xs" wrap>
                        <Chip label={meal.kitchenName} tone="neutral" icon="organisation" />
                        {meal.preparationMinutes === null ? null : (
                            <Chip
                                label={t('marketplace:menu.preparationMinutes', {
                                    minutes: meal.preparationMinutes,
                                })}
                                tone="neutral"
                            />
                        )}
                    </Inline>

                    <Stack space="xs" testID={`${testID}-nutrition`}>
                        <Text variant="label">
                            {t('marketplace:menu.perServing', { serving: meal.serving.label })}
                        </Text>
                        <Inline space="xs" wrap>
                            <Badge
                                tone="neutral"
                                label={t('marketplace:nutrition.energy', {
                                    energy: nutrientValue(meal.nutrition, 'energy'),
                                })}
                            />
                            <Badge
                                tone="neutral"
                                label={t('marketplace:nutrition.protein', {
                                    protein: nutrientValue(meal.nutrition, 'protein'),
                                })}
                            />
                            <Badge
                                tone="neutral"
                                label={t('marketplace:nutrition.carbohydrate', {
                                    carbohydrate: nutrientValue(meal.nutrition, 'carbohydrate'),
                                })}
                            />
                            <Badge
                                tone="neutral"
                                label={t('marketplace:nutrition.fat', {
                                    fat: nutrientValue(meal.nutrition, 'fat'),
                                })}
                            />
                        </Inline>
                        <Text testID={`${testID}-source`} tone="secondary" variant="caption">
                            {t('marketplace:nutrition.source', {
                                source: meal.nutrition.source.label,
                            })}
                        </Text>
                    </Stack>

                    <Stack space="xs" testID={`${testID}-allergens`}>
                        <Text variant="label">{t('marketplace:menu.allergensTitle')}</Text>
                        {meal.allergens.length === 0 ? (
                            <Text tone="secondary" variant="caption">
                                {t('marketplace:menu.noDeclaredAllergens')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {meal.allergens.map((code) => (
                                    <Chip
                                        key={code}
                                        tone="warning"
                                        icon="warning"
                                        label={t(`marketplace:allergens.${code}`)}
                                    />
                                ))}
                            </Inline>
                        )}
                    </Stack>

                    <Text testID={`${testID}-price`} variant="bodyStrong">
                        {formatMoney(formatter, meal.price)}
                    </Text>

                    <Callout
                        testID={`${testID}-handoff`}
                        role="note"
                        tone="info"
                        icon="prototype"
                        title={t('marketplace:menu.fullDetailsTitle')}
                        body={t('marketplace:menu.fullDetailsBody')}
                    />

                    {/* Default test id on purpose: the invariant every wave asserts is that a
                        screen showing nutrition figures carries `medical-disclaimer`, and a
                        per-surface id would make that assertion per-surface too. */}
                    <MedicalDisclaimer />
                </Stack>
            )}
        </Drawer>
    );
}
