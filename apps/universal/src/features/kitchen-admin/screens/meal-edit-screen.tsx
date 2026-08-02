import { isValidationFailure } from '@healthy360/api-client/contracts';
import type { LocalisedText, MealAdmin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    FilterChip,
    Heading,
    Icon,
    Inline,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { DIET_CLASSIFICATIONS, MEAL_TYPES, MealId } from '@healthy360/domain-types';
import type { DietClassification, MealType, RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    recipesFromPages,
    useAdminMealQuery,
    useCreateMealMutation,
    usePublishMealMutation,
    useRecipesQuery,
    useRetireMealMutation,
    useSetMealAvailabilityMutation,
    useUpdateMealMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import {
    MealAvailabilityEditor,
    availabilityErrors,
    emptyAvailabilityDay,
} from '../catalogue-row-editors.tsx';
import type { AvailabilityDraft } from '../catalogue-row-editors.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    availableChannels,
    channelKey,
    dietClassificationKey,
    displayName,
    isTranslationIncomplete,
    mealTypeKey,
    parseClockTime,
    parseQuantity,
    parseWholeNumber,
} from '../format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/meals/{meal}` — the one editor in this workspace whose save a shopper can see.
 *
 * ## Publication is the whole point of the screen
 *
 * A published meal is in `marketplace.listMeals` and on its own public page; a draft one is invisible
 * outside the kitchen. In this world that is literally true rather than a claim about a future
 * backend — admin and consumer read one store — so the publish dialog states the consequence, lists
 * the allergen label about to go public, and the editor offers a link straight to the public page
 * afterwards. That link is not decoration: it is the shortest way for the person who pressed the
 * button to check that what they published is what a customer now sees.
 *
 * ## Three things are read-only here, each for its own reason
 *
 * 1. **Allergens.** `MealAdmin.allergens` is frozen at publication from the recipe version's
 *    declaration and the contract has no meal-level setter. Editing a meal's label directly is
 *    exactly the food-safety hole the derivation exists to close, so the panel names its provenance —
 *    the recipe and the version — and links to the place the label can actually be changed.
 * 2. **Channel availability.** `setProductChannelAvailability` is a *product* method. Meals carry
 *    channels on the read shape with no writer, so they are shown as a fact.
 * 3. **The margin.** Confidential, and a number nobody can retype: it is derived from the recipe's
 *    cost per serving against a confirmed price. `null` when either side is missing, which is honest —
 *    a margin over a placeholder price is a fiction (plan §2.4).
 *
 * ## Availability is a calendar, not a rule
 *
 * `setMealAvailability` takes days keyed by `YYYY-MM-DD`. See `../catalogue-row-editors.tsx`: the
 * editor renders exactly that and invents no recurrence the contract cannot store.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

/** The "bought in rather than cooked" answer of the recipe picker. Never a real identifier. */
const NO_RECIPE = '__none__';

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly recipeId: RecipeId | null;
    readonly portionFactor: string;
    readonly mealTypes: readonly MealType[];
    readonly dietClassifications: readonly DietClassification[];
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    recipeId: null,
    portionFactor: '1',
    mealTypes: [],
    dietClassifications: [],
};

function detailsFrom(meal: MealAdmin): DetailsDraft {
    return {
        name: meal.name,
        description: meal.description,
        recipeId: meal.recipeId,
        portionFactor: String(meal.portionFactor),
        mealTypes: meal.mealTypes,
        dietClassifications: meal.dietClassifications,
    };
}

function availabilityFrom(meal: MealAdmin): readonly AvailabilityDraft[] {
    return meal.availability.map((day, index) => ({
        key: `seed-${String(index)}-${day.date}`,
        date: day.date,
        isAvailable: day.isAvailable,
        remaining: day.remaining === null ? '' : String(day.remaining),
        orderCutOffAt: day.orderCutOffAt ?? '',
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface MealEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly meal: string | undefined;
}

export function MealEditScreen({ meal }: MealEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-meal-editor"
        >
            <MealEditor meal={meal} />
        </Gate>
    );
}

function MealEditor({ meal }: MealEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = meal === undefined || meal === 'new';
    const parsed = isCreating ? null : MealId.safeParse(meal);

    const record = useAdminMealQuery(parsed);
    const recipes = useRecipesQuery({ limit: 100 });

    const create = useCreateMealMutation();
    const update = useUpdateMealMutation();
    const setAvailability = useSetMealAvailabilityMutation();
    const publish = usePublishMealMutation();
    const retire = useRetireMealMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [days, setDays] = useState<readonly AvailabilityDraft[]>([]);
    const [daysKey, setDaysKey] = useState<string | null>(null);
    const [daysDirty, setDaysDirty] = useState(false);
    const [nextDayOrdinal, setNextDayOrdinal] = useState(1);

    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== daysKey && !daysDirty) {
        setDaysKey(serverKey);
        setDays(availabilityFrom(data));
    }

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    const markDaysDirty = () => {
        setDaysDirty(true);
        guard.markDirty();
    };

    const settle = (nextDetailsDirty: boolean, nextDaysDirty: boolean) => {
        setDetailsDirty(nextDetailsDirty);
        setDaysDirty(nextDaysDirty);
        if (!nextDetailsDirty && !nextDaysDirty) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setDaysDirty(false);
        setDetailsKey(null);
        setDaysKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const takeDayKey = (): string => {
        const key = `day-${String(nextDayOrdinal)}`;
        setNextDayOrdinal(nextDayOrdinal + 1);
        return key;
    };

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    const recipeRows = recipesFromPages(recipes.data?.pages);
    const recipeOptions: readonly SelectOption[] = useMemo(
        () => [
            { value: NO_RECIPE, label: t('kitchen:meals.recipeNone') },
            ...recipeRows.map((row) => ({
                value: String(row.id),
                label: displayName(row.name, locale).value,
                description: row.slug,
            })),
        ],
        [recipeRows, locale, t],
    );

    const linkedRecipe = recipeRows.find((row) => row.id === details.recipeId) ?? null;

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const dayErrors = useMemo(
        () =>
            availabilityErrors(days, {
                dateRequired: t('kitchen:availability.dateRequired'),
                dateDuplicate: t('kitchen:availability.dateDuplicate'),
                remainingInvalid: t('kitchen:availability.remainingInvalid'),
                cutOffInvalid: t('kitchen:availability.cutOffInvalid'),
            }),
        [days, t],
    );

    const nameMissing = details.name.en.trim() === '';
    const portion = parseQuantity(details.portionFactor);
    const portionInvalid = portion === null || portion <= 0;
    const detailsBlocked = nameMissing || portionInvalid;

    /**
     * Everything standing between this meal and a public listing.
     *
     * Split from the quarantine deliberately: a blocker is something a person can fix here and now,
     * while a quarantine is a fact about the record that publication is refused from structurally.
     * Unsaved changes are a blocker because publishing publishes what the server holds, not what is
     * on screen — the same rule the recipe editor states.
     */
    const publishBlockers = useMemo(() => {
        if (data === undefined) return [];
        const reasons: string[] = [];
        if (isTranslationIncomplete(data.name)) reasons.push(t('kitchen:meals.blockName'));
        if (isTranslationIncomplete(data.description)) {
            reasons.push(t('kitchen:meals.blockDescription'));
        }
        if (data.mealTypes.length === 0) reasons.push(t('kitchen:meals.blockMealTypes'));
        if (detailsDirty || daysDirty) reasons.push(t('kitchen:meals.blockUnsaved'));
        return reasons;
    }, [data, detailsDirty, daysDirty, t]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveDetails = () => {
        if (detailsBlocked || portion === null) return;

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    description: details.description,
                    portionFactor: portion,
                    mealTypes: details.mealTypes,
                    dietClassifications: details.dietClassifications,
                    ...(details.recipeId === null ? {} : { recipeId: details.recipeId }),
                },
                {
                    onSuccess: (created) => {
                        settle(false, false);
                        toast.show({
                            testID: 'kitchen-meal-created-toast',
                            tone: 'success',
                            message: t('kitchen:meals.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`/kitchen/meals/${String(created.id)}` as never);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        update.mutate(
            {
                mealId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    description: details.description,
                    recipeId: details.recipeId,
                    portionFactor: portion,
                    mealTypes: details.mealTypes,
                    dietClassifications: details.dietClassifications,
                },
            },
            {
                onSuccess: () => {
                    settle(false, daysDirty);
                    toast.show({
                        testID: 'kitchen-meal-saved-toast',
                        tone: 'success',
                        message: t('kitchen:editor.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const saveAvailability = () => {
        if (data === undefined || dayErrors.size > 0) return;

        setAvailability.mutate(
            {
                mealId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    days: days.flatMap((row) =>
                        row.date === null
                            ? []
                            : [
                                  {
                                      date: row.date,
                                      isAvailable: row.isAvailable,
                                      remaining:
                                          row.remaining.trim() === ''
                                              ? null
                                              : parseWholeNumber(row.remaining),
                                      orderCutOffAt:
                                          row.orderCutOffAt.trim() === ''
                                              ? null
                                              : parseClockTime(row.orderCutOffAt),
                                  },
                              ],
                    ),
                },
            },
            {
                onSuccess: () => {
                    settle(detailsDirty, false);
                    toast.show({
                        testID: 'kitchen-meal-availability-saved-toast',
                        tone: 'success',
                        message: t('kitchen:availability.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-meal-editor-screen">
                <Callout
                    testID="kitchen-meal-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:meals.notFoundTitle')}
                    body={t('kitchen:meals.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-meal-not-found-back"
                            variant="secondary"
                            label={t('kitchen:meals.backToList')}
                            onPress={() => {
                                router.push('/kitchen/meals' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-meal-editor-loading">
                <Skeleton testID="kitchen-meal-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-meal-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-meal-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-meal-editor-screen">
                <ErrorState
                    testID="kitchen-meal-load-error"
                    failure={loadFailure}
                    title={t('kitchen:meals.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    const availabilityFailure = toFailure(setAvailability.error);
    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishRefusedByStatus = Object.keys(publishFields).includes('status');
    const quarantined = data?.meta.status === 'review_required';
    const isPublished = data?.meta.status === 'published';

    return (
        <EditorFrame
            testID="kitchen-meal-editor-screen"
            title={isCreating ? t('kitchen:meals.createTitle') : t('kitchen:meals.editTitle')}
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={create.isPending || update.isPending}
            saveDisabled={!canManage || detailsBlocked}
            backLabel={t('kitchen:meals.backToList')}
            onBack={() => {
                router.push('/kitchen/meals' as never);
            }}
            primaryAction={
                isCreating || !canManage ? null : (
                    <Inline space="xs" wrap justify="end">
                        {isPublished ? (
                            <Button
                                testID="kitchen-meal-retire"
                                variant="secondary"
                                label={t('kitchen:meals.retire')}
                                onPress={() => {
                                    setShowRetire(true);
                                }}
                            />
                        ) : (
                            <Button
                                testID="kitchen-meal-publish"
                                variant="secondary"
                                label={t('kitchen:publish.action')}
                                onPress={() => {
                                    setShowPublish(true);
                                }}
                            />
                        )}
                    </Inline>
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-meal-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {/*
                     * The proof, offered where it is useful. In this world the marketplace reads
                     * the same catalogue, so this link goes to the page a customer sees — which is
                     * the only way the person who pressed Publish can check what they published.
                     */}
                    {isPublished && data !== undefined ? (
                        <Callout
                            testID="kitchen-meal-published"
                            role="note"
                            tone="success"
                            title={t('kitchen:meals.publishedTitle')}
                            body={t('kitchen:meals.publishedBody')}
                            actions={
                                <Button
                                    testID="kitchen-meal-view-public"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:meals.viewPublic')}
                                    onPress={() => {
                                        guard.intercept(() => {
                                            router.push(`/meals/${String(data.id)}` as never);
                                        });
                                    }}
                                />
                            }
                        />
                    ) : null}

                    {data?.meta.status === 'retired' ? (
                        <Callout
                            testID="kitchen-meal-retired"
                            role="note"
                            tone="info"
                            title={t('kitchen:meals.retiredTitle')}
                            body={t('kitchen:meals.retiredBody')}
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-meal-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── the record ───────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-meal-details" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:meals.sectionDetails')}</Heading>

                    <BilingualField
                        testID="kitchen-meal-name"
                        fieldLabel={t('kitchen:fields.name')}
                        value={details.name}
                        requiredEnglish
                        {...(nameMissing ? { englishError: t('kitchen:meals.nameRequired') } : {})}
                        onChange={(next) => {
                            setDetails({ ...details, name: next });
                            markDetailsDirty();
                        }}
                    />

                    <BilingualField
                        testID="kitchen-meal-description"
                        fieldLabel={t('kitchen:meals.descriptionLabel')}
                        multiline
                        value={details.description}
                        onChange={(next) => {
                            setDetails({ ...details, description: next });
                            markDetailsDirty();
                        }}
                    />

                    <TextInputField
                        testID="kitchen-meal-portion"
                        id="kitchen-meal-portion"
                        label={t('kitchen:meals.portionLabel')}
                        hint={t('kitchen:meals.portionHint')}
                        value={details.portionFactor}
                        inputMode="decimal"
                        disabled={!canManage}
                        {...(portionInvalid ? { error: t('kitchen:meals.portionInvalid') } : {})}
                        onChangeText={(next) => {
                            setDetails({ ...details, portionFactor: next });
                            markDetailsDirty();
                        }}
                    />

                    {/*
                     * Chips rather than a multi-select: both vocabularies are short, closed platform
                     * enums, and every value is worth seeing at once — "is this a snack as well as a
                     * lunch?" is answered by looking, not by opening a dialog. `Select` in this
                     * design system is a single-answer modal radio group, so it could not express
                     * either of these without being made to lie about the interaction.
                     */}
                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-meal-types-label">
                            {t('kitchen:meals.mealTypesLabel')}
                        </Text>
                        <Inline space="xs" wrap testID="kitchen-meal-types">
                            {MEAL_TYPES.map((type) => (
                                <FilterChip
                                    key={type}
                                    testID={`kitchen-meal-type-${type}`}
                                    label={t(mealTypeKey(type))}
                                    selected={details.mealTypes.includes(type)}
                                    disabled={!canManage}
                                    onChange={(selected) => {
                                        setDetails({
                                            ...details,
                                            mealTypes: selected
                                                ? [...details.mealTypes, type]
                                                : details.mealTypes.filter(
                                                      (entry) => entry !== type,
                                                  ),
                                        });
                                        markDetailsDirty();
                                    }}
                                />
                            ))}
                        </Inline>
                    </Stack>

                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-meal-diets-label">
                            {t('kitchen:meals.dietsLabel')}
                        </Text>
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:meals.dietsHint')}
                        </Text>
                        <Inline space="xs" wrap testID="kitchen-meal-diets">
                            {DIET_CLASSIFICATIONS.map((diet) => (
                                <FilterChip
                                    key={diet}
                                    testID={`kitchen-meal-diet-${diet}`}
                                    label={t(dietClassificationKey(diet))}
                                    selected={details.dietClassifications.includes(diet)}
                                    disabled={!canManage}
                                    onChange={(selected) => {
                                        setDetails({
                                            ...details,
                                            dietClassifications: selected
                                                ? [...details.dietClassifications, diet]
                                                : details.dietClassifications.filter(
                                                      (entry) => entry !== diet,
                                                  ),
                                        });
                                        markDetailsDirty();
                                    }}
                                />
                            ))}
                        </Inline>
                    </Stack>
                </Stack>
            </Card>

            {/* ── recipe, allergens and channels ───────────────────────────────────────────── */}
            <Card testID="kitchen-meal-recipe" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:meals.sectionRecipe')}</Heading>

                    <Select
                        testID="kitchen-meal-recipe-select"
                        id="kitchen-meal-recipe-select"
                        label={t('kitchen:meals.recipeLabel')}
                        hint={t('kitchen:meals.recipeHint')}
                        searchable
                        disabled={!canManage}
                        options={recipeOptions}
                        value={details.recipeId === null ? NO_RECIPE : String(details.recipeId)}
                        onChange={(next) => {
                            setDetails({
                                ...details,
                                recipeId: next === NO_RECIPE ? null : (next as RecipeId),
                            });
                            markDetailsDirty();
                        }}
                    />

                    {details.recipeId === null ? null : (
                        <Inline space="sm" align="center" wrap>
                            <Text testID="kitchen-meal-recipe-linked">
                                {linkedRecipe === null
                                    ? String(details.recipeId)
                                    : displayName(linkedRecipe.name, locale).value}
                            </Text>
                            <Button
                                testID="kitchen-meal-recipe-open"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:meals.openRecipe')}
                                onPress={() => {
                                    const target = details.recipeId;
                                    if (target === null) return;
                                    guard.intercept(() => {
                                        router.push(`/kitchen/recipes/${String(target)}` as never);
                                    });
                                }}
                            />
                        </Inline>
                    )}

                    {/*
                     * Derived and frozen — see the module note. The provenance line names the
                     * version the label came from, because "which version of the recipe is this
                     * label from?" is the question a person has when the two disagree.
                     */}
                    <Stack space="xs" testID="kitchen-meal-allergens">
                        <Text variant="label">{t('kitchen:meals.allergensLabel')}</Text>
                        {data === undefined || data.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-meal-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:meals.allergensNone')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {data.allergens.map((code) => (
                                    <Badge
                                        key={code}
                                        testID={`kitchen-meal-allergen-${String(code)}`}
                                        tone="danger"
                                        label={String(code)}
                                    />
                                ))}
                            </Inline>
                        )}
                        <Text
                            testID="kitchen-meal-allergens-provenance"
                            variant="caption"
                            tone="secondary"
                        >
                            {data?.recipeVersionId == null
                                ? t('kitchen:meals.allergensNoProvenance')
                                : t('kitchen:meals.allergensProvenance', {
                                      version: String(data.recipeVersionId),
                                  })}
                        </Text>
                    </Stack>

                    <Stack space="xs" testID="kitchen-meal-channels">
                        <Text variant="label">{t('kitchen:meals.channelsLabel')}</Text>
                        {data === undefined ||
                        availableChannels(data.channelAvailability).length === 0 ? (
                            <Text
                                testID="kitchen-meal-channels-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:meals.noChannels')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {availableChannels(data.channelAvailability).map((channel) => (
                                    <Badge
                                        key={channel}
                                        testID={`kitchen-meal-channel-${channel}`}
                                        tone="info"
                                        label={t(channelKey(channel))}
                                    />
                                ))}
                            </Inline>
                        )}
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:meals.channelsReadOnly')}
                        </Text>
                    </Stack>
                </Stack>
            </Card>

            {/* ── confidential ─────────────────────────────────────────────────────────────── */}
            {isCreating ? null : (
                <View
                    testID="kitchen-meal-confidential"
                    className="rounded-lg border border-stroke-subtle bg-surface-raised p-4"
                >
                    <Stack space="sm">
                        <Inline space="sm" align="center" justify="between" wrap>
                            <Heading level={2}>{t('kitchen:meals.sectionMargin')}</Heading>
                            <Badge
                                testID="kitchen-meal-confidential-badge"
                                tone="info"
                                icon="eyeOff"
                                label={t('kitchen:meals.confidential')}
                            />
                        </Inline>

                        <Text tone="secondary" variant="caption">
                            {t('kitchen:meals.confidentialHint')}
                        </Text>

                        {data?.marginPercent == null ? (
                            <Inline space="sm" align="center" wrap>
                                <Icon name="info" />
                                <Text testID="kitchen-meal-margin-unknown" tone="secondary">
                                    {t('kitchen:meals.marginUnknown')}
                                </Text>
                            </Inline>
                        ) : (
                            <Text testID="kitchen-meal-margin" variant="bodyStrong">
                                {t('kitchen:meals.marginValue', { percent: data.marginPercent })}
                            </Text>
                        )}
                    </Stack>
                </View>
            )}

            {/* ── availability ─────────────────────────────────────────────────────────────── */}
            {isCreating ? (
                <Card testID="kitchen-meal-availability-unavailable" padding="md">
                    <Stack space="sm">
                        <Heading level={2}>{t('kitchen:availability.sectionTitle')}</Heading>
                        <Text tone="secondary">{t('kitchen:availability.createFirst')}</Text>
                    </Stack>
                </Card>
            ) : (
                <Card testID="kitchen-meal-availability" padding="md">
                    <Stack space="md">
                        <Inline space="sm" align="center" justify="between" wrap>
                            <Heading level={2}>{t('kitchen:availability.sectionTitle')}</Heading>
                            {canManage ? (
                                <Button
                                    testID="kitchen-meal-availability-add"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:availability.addDay')}
                                    onPress={() => {
                                        setDays([...days, emptyAvailabilityDay(takeDayKey())]);
                                        markDaysDirty();
                                    }}
                                />
                            ) : null}
                        </Inline>

                        {availabilityFailure === null ? null : (
                            <Callout
                                testID="kitchen-meal-availability-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:availability.saveError')}
                                body={availabilityFailure.message}
                            />
                        )}

                        <MealAvailabilityEditor
                            testID="kitchen-meal-availability-editor"
                            rows={days}
                            errors={dayErrors}
                            canManage={canManage}
                            onChange={(next) => {
                                setDays(next);
                                markDaysDirty();
                            }}
                        />

                        {canManage ? (
                            <Inline space="sm" wrap justify="end">
                                <Button
                                    testID="kitchen-meal-availability-save"
                                    variant="secondary"
                                    label={t('kitchen:availability.save')}
                                    loading={setAvailability.isPending}
                                    disabled={setAvailability.isPending || dayErrors.size > 0}
                                    onPress={saveAvailability}
                                />
                            </Inline>
                        ) : null}
                    </Stack>
                </Card>
            )}

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-meal-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:meals.publishTitle')}
                description={t('kitchen:meals.publishBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meal-publish-cancel"
                            variant="secondary"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-meal-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        mealId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (published) => {
                                            setShowPublish(false);
                                            toast.show({
                                                testID: 'kitchen-meal-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:meals.publishedToast', {
                                                    name: displayName(published.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text testID="kitchen-meal-publish-consequence">
                        {t('kitchen:meals.publishConsequence')}
                    </Text>

                    <Stack space="xs" testID="kitchen-meal-publish-allergens">
                        <Text variant="label">{t('kitchen:meals.publishAllergensTitle')}</Text>
                        {data === undefined || data.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-meal-publish-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:meals.publishAllergensNone')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {data.allergens.map((code) => (
                                    <Badge
                                        key={code}
                                        testID={`kitchen-meal-publish-allergen-${String(code)}`}
                                        tone="danger"
                                        label={String(code)}
                                    />
                                ))}
                            </Inline>
                        )}
                    </Stack>

                    {quarantined ? (
                        <Callout
                            testID="kitchen-meal-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-meal-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:meals.publishBlockedTitle')}
                        >
                            <Stack space="none">
                                {publishBlockers.map((reason) => (
                                    <Text key={reason} variant="caption">
                                        {reason}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}

                    {publishFailure === null ? null : (
                        <Callout
                            testID={
                                publishRefusedByStatus
                                    ? 'kitchen-meal-publish-refused-quarantine'
                                    : 'kitchen-meal-publish-failed'
                            }
                            role="alert"
                            tone={publishRefusedByStatus ? 'warning' : 'danger'}
                            title={
                                publishRefusedByStatus
                                    ? t('kitchen:publish.quarantineTitle')
                                    : t('kitchen:publish.failedTitle')
                            }
                            body={publishFailure.message}
                        />
                    )}
                </Stack>
            </Dialog>

            {/* ── retire ───────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-meal-retire-dialog"
                open={showRetire}
                onClose={() => {
                    setShowRetire(false);
                }}
                title={t('kitchen:meals.retireTitle')}
                description={t('kitchen:meals.retireBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meal-retire-cancel"
                            variant="secondary"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowRetire(false);
                            }}
                        />
                        <Button
                            testID="kitchen-meal-retire-confirm"
                            variant="danger"
                            label={t('kitchen:meals.retireConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                retire.mutate(
                                    {
                                        mealId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowRetire(false);
                                            toast.show({
                                                testID: 'kitchen-meal-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:meals.retiredToast', {
                                                    name: displayName(details.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            setShowRetire(false);
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Text testID="kitchen-meal-retire-consequence">
                    {t('kitchen:meals.retireConsequence')}
                </Text>
            </Dialog>
        </EditorFrame>
    );
}
