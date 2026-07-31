import {
    Accordion,
    Badge,
    Breadcrumbs,
    Button,
    Callout,
    Card,
    Chip,
    EmptyState,
    Heading,
    Inline,
    Rating,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';

import { EntityImage } from '../../../media/entity-image.tsx';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useAddCartItemMutation,
    useAddPlanEntryMutation,
    useCurrentPlanQuery,
    useMealQuery,
} from '../../../data/catalogue-hooks.ts';
import { PrototypeDialog } from '../../../prototype/index.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { AllergenList } from '../allergen-list.tsx';
import { MacroRings } from '../macro-rings.tsx';
import { NutritionFactsPanel } from '../nutrition-facts-panel.tsx';

/**
 * `/meals/{meal}` — the marketplace meal record.
 *
 * This is the screen the whole nutrition proposition rests on, and the one the reference research
 * found no public precedent for: neither product publishes a per-meal nutrition panel at all
 * (doc 09, RBN-08), let alone provenance, a per-100 g basis or a calculation timestamp (doc 09 §5,
 * ten requirements with no precedent). So it is designed from first principles and every figure
 * carries where it came from.
 *
 * ## Four actions, and why exactly one of them is a prototype notice
 *
 * * **Add to basket** is a real mutation. `CommerceRepository.addCartItem` exists, the mock world
 *   holds a real basket, and the shell's badge moves. An anonymous visitor gets a real navigation to
 *   sign-in instead, with the page recorded so they come back here.
 * * **Add to my meal plan** is a real mutation *when there is a plan to add to*. When there is not,
 *   the honest answer is a dialog that says so and offers two real destinations — not a silent
 *   failure and not a fake success.
 * * **Replace a meal in my plan** genuinely cannot be built here: replacement compares nutrition,
 *   cost and allergens against the entry being replaced (doc 17, PLN-15), which needs the planner.
 *   It gets a `PrototypeDialog` naming the contract and linking onward.
 * * **Request a bulk quotation** appears only when the kitchen is configured for business supply,
 *   and routes to the business programmes exactly as Wave 2's quotation control does.
 *
 * ## What is deliberately absent
 *
 * No contract price, no volume tier, no minimum order — for a b2b-enabled kitchen this page says
 * business supply exists and stops. `contracts/marketplace.ts` cannot represent a negotiated price
 * at all, and privacy by absence is the only version of that rule which survives a refactor.
 */
export interface MealDetailScreenProps {
    readonly mealId: string | undefined;
}

export function MealDetailScreen({ mealId }: MealDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();
    const { me } = useSession();
    const signedIn = me !== null;

    const parsed = mealId === undefined ? null : MealId.safeParse(mealId);
    const meal = useMealQuery(parsed);

    const currentPlan = useCurrentPlanQuery(signedIn);
    const addToBasket = useAddCartItemMutation();
    const addToPlan = useAddPlanEntryMutation();

    const [dialog, setDialog] = useState<'no-plan' | 'replace' | 'quotation' | null>(null);

    const here = parsed === null ? '/meals' : `/meals/${String(parsed)}`;
    const goSignIn = () => {
        recordResumeIntent({ href: here, labelKey: 'catalogue:nav.meals' });
        router.push('/sign-in');
    };

    const onAddToBasket = (item: MarketplaceMeal) => {
        if (!signedIn) {
            goSignIn();
            return;
        }
        addToBasket.mutate(
            { mealId: item.id, quantity: 1 },
            {
                onSuccess: (cart) => {
                    toast.show({
                        testID: 'basket-added',
                        tone: 'success',
                        message: t('catalogue:meal.addedToBasket', { items: cart.itemCount }),
                    });
                },
            },
        );
    };

    const onAddToPlan = (item: MarketplaceMeal) => {
        if (!signedIn) {
            goSignIn();
            return;
        }
        // Loading is not the same answer as "no plan": until the query settles the button is
        // disabled below, so this branch only ever sees a settled null.
        if (currentPlan.isPending) {
            return;
        }
        const plan = currentPlan.data;
        if (plan === null || plan === undefined) {
            setDialog('no-plan');
            return;
        }
        // The plan's own week start and the meal's primary meal type: the only two facts this page
        // holds. Choosing a different day is a planner decision, and the toast says which day it
        // landed on rather than leaving the person to guess.
        const mealType = item.mealTypes[0] ?? 'lunch';
        addToPlan.mutate(
            {
                planId: plan.planId,
                request: {
                    date: plan.weekStart,
                    mealType,
                    kind: 'kitchen_meal',
                    mealId: item.id,
                    label: item.name,
                },
            },
            {
                onSuccess: () => {
                    toast.show({
                        testID: 'plan-added',
                        tone: 'success',
                        message: t('catalogue:meal.addedToPlan', {
                            date: formatter.formatDate(`${plan.weekStart}T12:00:00.000Z`, {
                                dateStyle: 'medium',
                            }),
                            mealType: t(`marketplace:mealTypes.${mealType}`),
                        }),
                    });
                },
            },
        );
    };

    const item = meal.data;

    const browseAction = (
        <Button
            testID="meal-detail-browse"
            variant="secondary"
            label={t('catalogue:meal.browseAll')}
            onPress={() => {
                router.push('/meals');
            }}
        />
    );

    return (
        <Stack space="lg" testID="meal-detail-screen">
            <Breadcrumbs
                testID="meal-detail-breadcrumbs"
                items={[
                    {
                        key: 'home',
                        label: t('catalogue:nav.home'),
                        onPress: () => {
                            router.push('/');
                        },
                    },
                    {
                        key: 'meals',
                        label: t('catalogue:nav.meals'),
                        onPress: () => {
                            router.push('/meals');
                        },
                    },
                    { key: 'meal', label: item?.name ?? t('catalogue:meal.loading') },
                ]}
            />

            {/* A link carrying something that is not an identifier at all leaves the query
                disabled, and a disabled query never settles — so the not-found answer is rendered
                directly rather than behind a skeleton that would spin for ever. */}
            {parsed === null ? (
                <EmptyState
                    testID="meal-detail-empty"
                    title={t('catalogue:meal.notFoundTitle')}
                    body={t('catalogue:meal.notFoundBody')}
                    actions={browseAction}
                />
            ) : (
                <QueryStates
                    query={meal}
                    isEmpty={item === undefined}
                    emptyTitle={t('catalogue:meal.notFoundTitle')}
                    emptyBody={t('catalogue:meal.notFoundBody')}
                    emptyActions={browseAction}
                    skeletonCount={2}
                    testID="meal-detail"
                >
                    {item === undefined ? null : (
                        <Stack space="lg">
                            <EntityImage
                                testID="meal-detail-image"
                                assetId={item.imagePlaceholderId}
                                variant="detail"
                                seed={item.slug}
                                label={t('catalogue:meal.imageLabel', { meal: item.name })}
                                aspect="wide"
                            />

                            <Stack space="xs">
                                <Heading level={1} testID="meal-detail-name">
                                    {item.name}
                                </Heading>
                                <Text tone="secondary">{item.description}</Text>
                            </Stack>

                            <Inline space="sm" align="center" wrap>
                                <Button
                                    testID="meal-detail-kitchen"
                                    size="sm"
                                    variant="ghost"
                                    label={t('catalogue:meal.cookedBy', {
                                        kitchen: item.kitchenName,
                                    })}
                                    onPress={() => {
                                        router.push(`/kitchens/${String(item.kitchenId)}` as never);
                                    }}
                                />
                                {item.rating === null ? (
                                    <Text tone="secondary" variant="caption">
                                        {t('catalogue:meal.notRatedYet')}
                                    </Text>
                                ) : (
                                    <Rating
                                        testID="meal-detail-rating"
                                        label={t('catalogue:meal.ratingLabel', { meal: item.name })}
                                        value={item.rating}
                                        count={item.ratingCount}
                                        size="sm"
                                    />
                                )}
                                {item.preparationMinutes === null ? null : (
                                    <Chip
                                        label={t('catalogue:meal.preparationMinutes', {
                                            minutes: formatter.formatNumber(
                                                item.preparationMinutes,
                                            ),
                                        })}
                                        tone="neutral"
                                    />
                                )}
                            </Inline>

                            <Stack space="xs" testID="meal-detail-serving">
                                <Text variant="label">{t('catalogue:meal.servingTitle')}</Text>
                                <Text>
                                    {t('catalogue:meal.servingLabel', {
                                        serving: item.serving.label,
                                    })}
                                </Text>
                                {item.serving.grams === null ? null : (
                                    <Text tone="secondary" variant="caption">
                                        {t('catalogue:meal.servingGrams', {
                                            grams: formatter.formatNumber(item.serving.grams),
                                        })}
                                    </Text>
                                )}
                            </Stack>

                            <Stack space="sm" testID="meal-detail-macros">
                                <Text variant="label">{t('catalogue:meal.macrosTitle')}</Text>
                                <MacroRings
                                    testID="meal-detail-macro-rings"
                                    facts={item.nutrition}
                                />
                            </Stack>

                            <NutritionFactsPanel
                                testID="meal-detail-facts"
                                facts={item.nutrition}
                            />

                            <Stack space="xs" testID="meal-detail-allergens">
                                <Text variant="label">{t('catalogue:meal.allergensTitle')}</Text>
                                <AllergenList
                                    testID="meal-detail-allergen-list"
                                    allergens={item.allergens}
                                />
                            </Stack>

                            <Accordion
                                testID="meal-detail-composition"
                                items={[
                                    {
                                        key: 'ingredients',
                                        title: t('catalogue:meal.ingredientsTitle'),
                                        testID: 'meal-detail-ingredients-header',
                                        children: (
                                            <Stack space="xs">
                                                <Text tone="secondary">
                                                    {t('catalogue:meal.ingredientsBody')}
                                                </Text>
                                                <Text tone="secondary" variant="caption">
                                                    {t('catalogue:meal.ingredientsContract')}
                                                </Text>
                                            </Stack>
                                        ),
                                    },
                                    {
                                        key: 'composition',
                                        title: t('catalogue:meal.compositionTitle'),
                                        testID: 'meal-detail-provenance-header',
                                        children: (
                                            <Stack space="xs">
                                                {item.nutrition.calculation.notes.map((note) => (
                                                    <Text
                                                        key={note}
                                                        tone="secondary"
                                                        variant="caption"
                                                    >
                                                        {note}
                                                    </Text>
                                                ))}
                                                <Text tone="secondary" variant="caption">
                                                    {t('catalogue:facts.version', {
                                                        version: item.nutrition.source.version,
                                                    })}
                                                </Text>
                                            </Stack>
                                        ),
                                    },
                                ]}
                            />

                            <Stack space="xs" testID="meal-detail-diets">
                                <Text variant="label">{t('catalogue:meal.dietTagsTitle')}</Text>
                                <Inline space="xs" wrap>
                                    {item.dietClassifications.map((diet) => (
                                        <Chip
                                            key={diet}
                                            testID={`meal-detail-diet-${diet}`}
                                            tone="brand"
                                            label={t(`marketplace:diets.${diet}`)}
                                            onPress={() => {
                                                router.push(`/diets/${diet}` as never);
                                            }}
                                        />
                                    ))}
                                </Inline>
                            </Stack>

                            <Stack space="xs" testID="meal-detail-availability">
                                <Text variant="label">{t('catalogue:meal.availabilityTitle')}</Text>
                                {item.availability.length === 0 ? (
                                    <Text tone="secondary">
                                        {t('catalogue:meal.availabilityNone')}
                                    </Text>
                                ) : (
                                    <Inline space="xs" wrap>
                                        {item.availability.slice(0, 7).map((window) => {
                                            const date = formatter.formatDate(
                                                `${window.date}T12:00:00.000Z`,
                                                {
                                                    weekday: 'short',
                                                    day: 'numeric',
                                                    month: 'short',
                                                },
                                            );
                                            return (
                                                <Chip
                                                    key={window.date}
                                                    testID={`meal-detail-availability-${window.date}`}
                                                    tone={window.available ? 'success' : 'neutral'}
                                                    icon={window.available ? 'success' : 'close'}
                                                    label={
                                                        window.available
                                                            ? window.remaining === null
                                                                ? t('catalogue:meal.availableOn', {
                                                                      date,
                                                                  })
                                                                : t(
                                                                      'catalogue:meal.availableRemaining',
                                                                      {
                                                                          date,
                                                                          remaining:
                                                                              formatter.formatNumber(
                                                                                  window.remaining,
                                                                              ),
                                                                      },
                                                                  )
                                                            : t('catalogue:meal.unavailableOn', {
                                                                  date,
                                                              })
                                                    }
                                                />
                                            );
                                        })}
                                    </Inline>
                                )}
                            </Stack>

                            <Card testID="meal-detail-commerce" padding="md" tone="sunken">
                                <Stack space="md">
                                    <Stack space="xs">
                                        <Text variant="label">
                                            {t('catalogue:meal.priceTitle')}
                                        </Text>
                                        <Text testID="meal-detail-price" variant="bodyStrong">
                                            {t('catalogue:meal.priceEach', {
                                                price: formatMoney(formatter, item.price),
                                            })}
                                        </Text>
                                    </Stack>

                                    <Stack space="xs" testID="meal-detail-channels">
                                        <Text variant="label">
                                            {t('catalogue:meal.channelsTitle')}
                                        </Text>
                                        <Inline space="xs" wrap>
                                            <Badge
                                                testID="meal-detail-b2c"
                                                tone={item.channels.b2c ? 'success' : 'neutral'}
                                                label={
                                                    item.channels.b2c
                                                        ? t('catalogue:meal.b2cAvailable')
                                                        : t('catalogue:meal.b2cUnavailable')
                                                }
                                            />
                                            <Badge
                                                testID="meal-detail-subscription"
                                                tone={
                                                    item.channels.subscription
                                                        ? 'success'
                                                        : 'neutral'
                                                }
                                                label={
                                                    item.channels.subscription
                                                        ? t('catalogue:meal.subscriptionEligible')
                                                        : t('catalogue:meal.subscriptionIneligible')
                                                }
                                            />
                                            {item.channels.b2b ? (
                                                <Badge
                                                    testID="meal-detail-b2b"
                                                    tone="info"
                                                    label={t('catalogue:meal.b2bAvailable')}
                                                />
                                            ) : null}
                                        </Inline>
                                        {item.channels.b2b ? (
                                            <Text
                                                testID="meal-detail-b2b-no-price"
                                                tone="secondary"
                                                variant="caption"
                                            >
                                                {t('catalogue:meal.b2bNoPrice')}
                                            </Text>
                                        ) : null}
                                    </Stack>

                                    <Stack space="sm" testID="meal-detail-actions">
                                        <Text variant="label">
                                            {t('catalogue:meal.actionsTitle')}
                                        </Text>
                                        <Inline space="sm" wrap>
                                            <Button
                                                testID="meal-detail-add-to-basket"
                                                label={
                                                    !signedIn
                                                        ? t('catalogue:meal.basketSignIn')
                                                        : addToBasket.isPending
                                                          ? t('catalogue:meal.addingToBasket')
                                                          : t('catalogue:meal.addToBasket')
                                                }
                                                disabled={addToBasket.isPending}
                                                onPress={() => {
                                                    onAddToBasket(item);
                                                }}
                                            />
                                            <Button
                                                testID="meal-detail-add-to-plan"
                                                variant="secondary"
                                                label={
                                                    !signedIn
                                                        ? t('catalogue:meal.planSignIn')
                                                        : addToPlan.isPending
                                                          ? t('catalogue:meal.addingToPlan')
                                                          : t('catalogue:meal.addToPlan')
                                                }
                                                disabled={
                                                    addToPlan.isPending ||
                                                    (signedIn && currentPlan.isPending)
                                                }
                                                onPress={() => {
                                                    onAddToPlan(item);
                                                }}
                                            />
                                            <Button
                                                testID="meal-detail-replace"
                                                variant="ghost"
                                                label={t('catalogue:meal.replaceMeal')}
                                                onPress={() => {
                                                    setDialog('replace');
                                                }}
                                            />
                                            {item.channels.b2b ? (
                                                <Button
                                                    testID="meal-detail-quotation"
                                                    variant="ghost"
                                                    label={t('catalogue:meal.requestQuotation')}
                                                    onPress={() => {
                                                        setDialog('quotation');
                                                    }}
                                                />
                                            ) : null}
                                        </Inline>

                                        {addToBasket.isError || addToPlan.isError ? (
                                            <Callout
                                                testID="meal-detail-action-error"
                                                role="alert"
                                                tone="danger"
                                                title={t('catalogue:meal.actionErrorTitle')}
                                                body={t('catalogue:meal.actionErrorBody')}
                                            />
                                        ) : null}
                                    </Stack>
                                </Stack>
                            </Card>

                            <MedicalDisclaimer />
                        </Stack>
                    )}
                </QueryStates>
            )}

            <PrototypeDialog
                testID="meal-detail-no-plan-dialog"
                open={dialog === 'no-plan'}
                onClose={() => {
                    setDialog(null);
                }}
                title={t('catalogue:meal.noPlanTitle')}
                description={t('catalogue:meal.noPlanBody')}
                contract="POST /api/v1/meal-plans/generate"
                actions={
                    <>
                        <Button
                            testID="meal-detail-no-plan-browse"
                            variant="secondary"
                            label={t('catalogue:meal.noPlanBrowse')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/plans');
                            }}
                        />
                        <Button
                            testID="meal-detail-no-plan-home"
                            label={t('catalogue:meal.noPlanHome')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/customer');
                            }}
                        />
                    </>
                }
            />

            <PrototypeDialog
                testID="meal-detail-replace-dialog"
                open={dialog === 'replace'}
                onClose={() => {
                    setDialog(null);
                }}
                title={t('catalogue:meal.replaceTitle')}
                description={t('catalogue:meal.replaceBody')}
                contract="POST /api/v1/meal-plans/{plan}/entries/{entry}/replace"
                actions={
                    <>
                        <Button
                            testID="meal-detail-replace-browse"
                            variant="secondary"
                            label={t('catalogue:meal.browseAll')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/meals');
                            }}
                        />
                        <Button
                            testID="meal-detail-replace-home"
                            label={t('catalogue:meal.noPlanHome')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/customer');
                            }}
                        />
                    </>
                }
            />

            <PrototypeDialog
                testID="meal-detail-quotation-dialog"
                open={dialog === 'quotation'}
                onClose={() => {
                    setDialog(null);
                }}
                title={t('catalogue:meal.quotationTitle')}
                description={t('catalogue:meal.quotationBody')}
                contract="POST /api/v1/business/quotations"
                actions={
                    <>
                        <Button
                            testID="meal-detail-quotation-business"
                            variant="secondary"
                            label={t('catalogue:meal.quotationBusiness')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/for-business');
                            }}
                        />
                        <Button
                            testID="meal-detail-quotation-sign-in"
                            label={t('catalogue:meal.quotationSignIn')}
                            onPress={() => {
                                setDialog(null);
                                router.push('/sign-in');
                            }}
                        />
                    </>
                }
            />
        </Stack>
    );
}
