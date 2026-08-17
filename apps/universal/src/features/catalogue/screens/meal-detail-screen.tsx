import {
    Accordion,
    Badge,
    Breadcrumbs,
    Button,
    Callout,
    Card,
    Chip,
    Dialog,
    EmptyState,
    Heading,
    Inline,
    Rating,
    Stack,
    Text,
    useBreakpoint,
    useToast,
} from '@healthy360/design-system';

import { EntityImage } from '../../../media/entity-image.tsx';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { MealId } from '@healthy360/domain-types';
import type { DietClassification } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAddCartItemMutation, useMealQuery } from '../../../data/catalogue-hooks.ts';
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
 * ## One action, and it is real
 *
 * **Add to basket** is a real mutation. `CommerceRepository.addCartItem` exists, the shell's badge
 * moves, and an anonymous visitor is offered the guest route or sign-in rather than a wall.
 *
 * Three others used to sit beside it — add to my meal plan, replace a meal in my plan, request a
 * bulk quotation. All three needed a contract the API does not implement (the planner, and the
 * quotation document endpoint), so all three ended in a dialog explaining that nothing happened.
 * `src/features/availability.ts` says as much in one place now, and the buttons are gone until it
 * says otherwise. The diet chips below stay visible because the classification is real information
 * about the meal; they are no longer pressable because `/diets/{diet}` is not reachable.
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
    const { atLeast } = useBreakpoint();
    const formatter = useFormatter();
    const toast = useToast();
    const { me } = useSession();
    const signedIn = me !== null;

    const parsed = mealId === undefined ? null : MealId.safeParse(mealId);
    const meal = useMealQuery(parsed);

    const addToBasket = useAddCartItemMutation();

    const [dialog, setDialog] = useState<'guest-entry' | null>(null);

    const here = parsed === null ? '/meals' : `/meals/${String(parsed)}`;
    const goSignIn = () => {
        recordResumeIntent({ href: here, labelKey: 'catalogue:nav.meals' });
        router.push('/sign-in');
    };

    /**
     * Adding to the basket while signed out.
     *
     * **This used to redirect to sign-in, and that was the wall G1 exists to remove.** An anonymous
     * visitor who has decided what they want is at the moment of highest intent, and answering it
     * with "make an account first" is where most of them stop. So the choice is offered instead:
     * carry on as a guest, or sign in — and signing in stays a *visible* option rather than being
     * replaced, because somebody who already has an account is better served by it (their addresses
     * and past orders are there).
     *
     * The item goes into the basket either way before we navigate. The basket is not part of the
     * guest session — it exists before one is started and survives one expiring — so putting the
     * meal in it first means the guest checkout opens on a basket that already holds what the
     * person just chose, rather than on an empty one they have to fill again.
     */
    const onAddToBasket = (item: MarketplaceMeal) => {
        if (!signedIn) {
            setDialog('guest-entry');
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

    const item = meal.data;

    /** Whether there is a second column to put the classification and the price panel in. */
    const wide = atLeast('lg');

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
                            {/*
                             * The head of the page is two columns from `lg` up, and the reason is
                             * arithmetic. The shell caps its content at 1152, so a full-width 16:9
                             * photograph was 648 units tall — the entire first screen was the
                             * picture, the dish's name began below the fold, and the price and
                             * "add to basket" sat about three and a half screens down, under the
                             * nutrition table. A product page that puts its one action there is
                             * asking to be abandoned.
                             *
                             * So the photograph is capped and set beside what a person actually
                             * came to read: the name, who cooked it, the serving, the
                             * classification, the price and the button. Everything that rewards a
                             * wide measure — the macro rings, the nutrition table, the allergen
                             * list — stays full width below. Below `lg` the two columns collapse
                             * back into the single column the phone already had; the cap on the
                             * image is the only part that applies at every width, because a 16:9
                             * image is too tall for a tablet as well.
                             */}
                            <View className="flex-col gap-6 lg:flex-row lg:items-start">
                                <View className="w-full max-w-[560px] lg:w-[45%] lg:shrink-0">
                                    <EntityImage
                                        testID="meal-detail-image"
                                        assetId={item.imagePlaceholderId}
                                        variant="detail"
                                        seed={item.slug}
                                        label={t('catalogue:meal.imageLabel', { meal: item.name })}
                                        aspect="wide"
                                    />
                                </View>

                                <Stack space="md" className="flex-1">
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
                                                router.push(
                                                    `/kitchens/${String(item.kitchenId)}` as never,
                                                );
                                            }}
                                        />
                                        {item.rating === null ? (
                                            <Text tone="secondary" variant="caption">
                                                {t('catalogue:meal.notRatedYet')}
                                            </Text>
                                        ) : (
                                            <Rating
                                                testID="meal-detail-rating"
                                                label={t('catalogue:meal.ratingLabel', {
                                                    meal: item.name,
                                                })}
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
                                        <Text variant="label">
                                            {t('catalogue:meal.servingTitle')}
                                        </Text>
                                        <Text>
                                            {t('catalogue:meal.servingLabel', {
                                                serving: item.serving.label,
                                            })}
                                        </Text>
                                        {item.serving.grams === null ? null : (
                                            <Text tone="secondary" variant="caption">
                                                {t('catalogue:meal.servingGrams', {
                                                    grams: formatter.formatNumber(
                                                        item.serving.grams,
                                                    ),
                                                })}
                                            </Text>
                                        )}
                                    </Stack>

                                    {/*
                                     * The classification and the commerce panel are in the
                                     * column beside the photograph *only* where there is a column
                                     * to put them in. Below `lg` they stay exactly where they have
                                     * always been — the classification under the composition
                                     * accordion, the price under the availability strip — because
                                     * a phone's reading order is not a thing to reshuffle while
                                     * fixing a desktop layout. One branch rather than two rendered
                                     * copies with one hidden: a hidden copy is still in the
                                     * accessibility tree, and this page would then announce two
                                     * prices and two "add to basket" buttons.
                                     */}
                                    {wide ? (
                                        <MealDietTags diets={item.dietClassifications} />
                                    ) : null}
                                    {wide ? (
                                        <MealCommercePanel
                                            item={item}
                                            signedIn={signedIn}
                                            pending={addToBasket.isPending}
                                            errored={addToBasket.isError}
                                            onAdd={() => {
                                                onAddToBasket(item);
                                            }}
                                        />
                                    ) : null}
                                </Stack>
                            </View>

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

                            {wide ? null : <MealDietTags diets={item.dietClassifications} />}

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

                            {wide ? null : (
                                <MealCommercePanel
                                    item={item}
                                    signedIn={signedIn}
                                    pending={addToBasket.isPending}
                                    errored={addToBasket.isError}
                                    onAdd={() => {
                                        onAddToBasket(item);
                                    }}
                                />
                            )}

                            <MedicalDisclaimer />
                        </Stack>
                    )}
                </QueryStates>
            )}

            {/*
             * The guest entry point (plan Phase G1).
             *
             * A real dialog rather than a redirect, and both routes out of it are real: "continue
             * as a guest" puts the meal in the basket and opens `/guest-checkout`, "sign in
             * instead" does exactly what this button used to do — including recording the page, so
             * somebody who signs in lands back here.
             */}
            <Dialog
                testID="meal-detail-guest-entry-dialog"
                open={dialog === 'guest-entry'}
                onClose={() => {
                    setDialog(null);
                }}
                title={t('guest:entry.title')}
                description={t('guest:entry.body')}
                actions={
                    <>
                        <Button
                            testID="meal-detail-guest-sign-in"
                            variant="secondary"
                            label={t('guest:entry.signIn')}
                            onPress={() => {
                                setDialog(null);
                                goSignIn();
                            }}
                        />
                        <Button
                            testID="meal-detail-guest-continue"
                            label={t('guest:entry.continueAsGuest')}
                            loading={addToBasket.isPending}
                            onPress={() => {
                                const item = meal.data;
                                if (item === undefined) return;
                                setDialog(null);
                                addToBasket.mutate(
                                    { mealId: item.id, quantity: 1 },
                                    {
                                        onSuccess: () => {
                                            router.push('/guest-checkout');
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />
        </Stack>
    );
}

/**
 * The dietary classification, as labels rather than links.
 *
 * The classification is real information about the meal and stays on the page; `/diets/{diet}` has
 * no backend, so a press would land on a redirect.
 *
 * It is a component rather than inline JSX because it is rendered in one of two places — beside the
 * photograph on a wide screen, under the composition accordion otherwise — and the two must not be
 * allowed to drift apart.
 */
function MealDietTags({ diets }: { readonly diets: readonly DietClassification[] }) {
    const { t } = useTranslation();

    return (
        <Stack space="xs" testID="meal-detail-diets">
            <Text variant="label">{t('catalogue:meal.dietTagsTitle')}</Text>
            <Inline space="xs" wrap>
                {diets.map((diet) => (
                    <Chip
                        key={diet}
                        testID={`meal-detail-diet-${diet}`}
                        tone="brand"
                        label={t(`marketplace:diets.${diet}`)}
                    />
                ))}
            </Inline>
        </Stack>
    );
}

interface MealCommercePanelProps {
    readonly item: MarketplaceMeal;
    readonly signedIn: boolean;
    readonly pending: boolean;
    readonly errored: boolean;
    readonly onAdd: () => void;
}

/**
 * Price, the channels the meal is sold through, and the one real action on the page.
 *
 * Same reason as {@link MealDietTags} for being a component: it has two homes and one definition.
 */
function MealCommercePanel({ item, signedIn, pending, errored, onAdd }: MealCommercePanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Card testID="meal-detail-commerce" padding="md" tone="sunken">
            <Stack space="md">
                <Stack space="xs">
                    <Text variant="label">{t('catalogue:meal.priceTitle')}</Text>
                    <Text testID="meal-detail-price" variant="bodyStrong">
                        {t('catalogue:meal.priceEach', {
                            price: formatMoney(formatter, item.price),
                        })}
                    </Text>
                </Stack>

                <Stack space="xs" testID="meal-detail-channels">
                    <Text variant="label">{t('catalogue:meal.channelsTitle')}</Text>
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
                            tone={item.channels.subscription ? 'success' : 'neutral'}
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
                        <Text testID="meal-detail-b2b-no-price" tone="secondary" variant="caption">
                            {t('catalogue:meal.b2bNoPrice')}
                        </Text>
                    ) : null}
                </Stack>

                <Stack space="sm" testID="meal-detail-actions">
                    <Text variant="label">{t('catalogue:meal.actionsTitle')}</Text>
                    <Inline space="sm" wrap>
                        <Button
                            testID="meal-detail-add-to-basket"
                            label={
                                !signedIn
                                    ? t('catalogue:meal.basketSignIn')
                                    : pending
                                      ? t('catalogue:meal.addingToBasket')
                                      : t('catalogue:meal.addToBasket')
                            }
                            disabled={pending}
                            onPress={onAdd}
                        />
                    </Inline>

                    {errored ? (
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
    );
}
