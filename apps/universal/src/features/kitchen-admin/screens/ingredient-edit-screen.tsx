import { ALLERGEN_CONTAINMENTS, ALLERGEN_VERIFICATIONS } from '@healthy360/api-client/contracts';
import type {
    AllergenClass,
    AllergenContainment,
    AllergenVerification,
    IngredientAdmin,
    IngredientAllergenMapping,
    LocalisedText,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Chip,
    Dialog,
    ErrorState,
    Heading,
    Icon,
    Inline,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { IngredientId } from '@healthy360/domain-types';
import type { AllergenCode } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useAllergenClassesQuery,
    useArchiveIngredientMutation,
    useCreateIngredientMutation,
    useIngredientCategoriesQuery,
    useIngredientQuery,
    useSetIngredientAllergensMutation,
    useUpdateIngredientMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    UNIT_DIMENSIONS,
    containmentKey,
    displayName,
    humaniseCode,
    unitDimension,
    unitDimensionKey,
    unitKey,
    verificationKey,
} from '../format.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/ingredients/{ingredient}` — the record editor, and the allergen mapping editor with it.
 *
 * ## Two sections, two writes, one lock version
 *
 * `KitchenAdminRepository` writes an ingredient's fields with `updateIngredient` and its allergen
 * determination with `setIngredientAllergens`, and that split is deliberate rather than incidental:
 * a mapping is judged as a *set* ("contains milk, may contain nuts, supplier-declared on this date"
 * is one decision), so it is replaced wholesale and audited as its own act. The screen mirrors the
 * contract — each section has its own save — and both writes carry the same `lockVersion`, read from
 * the query cache at the moment of saving. That is what makes the conflict path real: a write that
 * lands from anywhere else moves the version, and the next save here is refused with
 * `resource.conflict`.
 *
 * Each section rehydrates from the server's answer, and each skips rehydration while *it* has
 * unsaved edits. Saving the mapping therefore never discards a half-typed name, and vice versa.
 *
 * ## Platform baseline rows are upgrade-only
 *
 * A seeded ingredient belongs to the shared platform library (`organisationId === null`), and the
 * mappings it arrives with are the platform's determination. A kitchen may **strengthen** one —
 * "may contain" to "contains", supplier-declared to laboratory-tested — and may add its own rows,
 * but weakening a platform baseline is refused per row with an inline message and blocks the save.
 * That is the "upgrade-only" rule in D-041's spirit: kitchens own mappings, not the platform's
 * safety floor.
 *
 * **Removing** a baseline row is still possible, because the source material contains determinations
 * that are simply *wrong* (the burghul and pita rows tagged "no allergens" by a sheet whose own key
 * says otherwise) and a catalogue nobody can correct is worse than one that records the correction.
 * The store answers that removal the way the plan requires: if a published recipe derives the label
 * from this ingredient, both records move to `review_required` and publication is refused until a
 * person resolves it. The editor renders that quarantine rather than hiding it.
 *
 * ## No prototype notices here
 *
 * Every control on this screen mutates the mock store through the contract. Nothing is decorative.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly reference: string;
    readonly categoryCode: string;
    readonly measurementUnit: MeasureUnit;
    readonly notes: string;
    readonly aliases: readonly string[];
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    reference: '',
    categoryCode: '',
    measurementUnit: 'g',
    notes: '',
    aliases: [],
};

function detailsFrom(ingredient: IngredientAdmin): DetailsDraft {
    return {
        name: ingredient.name,
        reference: ingredient.reference ?? '',
        categoryCode: ingredient.categoryCode,
        measurementUnit: ingredient.measurementUnit,
        notes: ingredient.notes ?? '',
        aliases: [...ingredient.aliases],
    };
}

/** A mapping row as the editor holds it, plus where it came from. */
interface MappingRow {
    /** Stable within the session. Never random — the store's rule, and it keeps tests readable. */
    readonly key: string;
    readonly origin: 'baseline' | 'overlay';
    /** The determination this row started from, for the upgrade-only comparison. `null` when added. */
    readonly baseline: IngredientAllergenMapping | null;
    readonly allergenCode: AllergenCode | null;
    readonly containment: AllergenContainment;
    readonly marketScope: string;
    readonly verification: AllergenVerification;
    readonly sourceNote: string;
}

function rowsFrom(ingredient: IngredientAdmin): readonly MappingRow[] {
    return ingredient.allergens.map((mapping) => ({
        key: `baseline-${String(mapping.allergenCode)}`,
        origin: 'baseline' as const,
        baseline: mapping,
        allergenCode: mapping.allergenCode,
        containment: mapping.containment,
        marketScope: mapping.marketScope.join(', '),
        verification: mapping.verification,
        sourceNote: mapping.sourceNote ?? '',
    }));
}

function parseMarkets(value: string): readonly string[] {
    return value
        .split(',')
        .map((entry) => entry.trim().toLocaleUpperCase())
        .filter((entry) => entry !== '');
}

/** Weakest to strongest. `ALLERGEN_VERIFICATIONS` is ordered by contract; this reads the order. */
function verificationRank(verification: AllergenVerification): number {
    return ALLERGEN_VERIFICATIONS.indexOf(verification);
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface IngredientEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly ingredient: string | undefined;
}

export function IngredientEditScreen({ ingredient }: IngredientEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-ingredient-editor"
        >
            <IngredientEditor ingredient={ingredient} />
        </Gate>
    );
}

function IngredientEditor({ ingredient }: IngredientEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = ingredient === undefined || ingredient === 'new';
    const parsed = isCreating ? null : IngredientId.safeParse(ingredient);

    const record = useIngredientQuery(parsed);
    const classes = useAllergenClassesQuery();
    const categories = useIngredientCategoriesQuery();

    const create = useCreateIngredientMutation();
    const update = useUpdateIngredientMutation();
    const setAllergens = useSetIngredientAllergensMutation();
    const archive = useArchiveIngredientMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [rows, setRows] = useState<readonly MappingRow[]>([]);
    const [rowsKey, setRowsKey] = useState<string | null>(null);
    const [rowsDirty, setRowsDirty] = useState(false);
    const [nextRowOrdinal, setNextRowOrdinal] = useState(1);

    const [aliasInput, setAliasInput] = useState('');
    const [aliasError, setAliasError] = useState<string | null>(null);
    const [removedAlias, setRemovedAlias] = useState<string | null>(null);
    const [showArchive, setShowArchive] = useState(false);

    const data = record.data;

    /**
     * Whether this record is in the stored quarantine — read from the record, not remembered.
     *
     * It used to be `useState`, set only in the mapping save's `onSuccess`, which meant an
     * ingredient that *arrived* quarantined showed no banner at all: reload the page, or follow the
     * deep link the K1.8 review queue offers, and the one fact the screen most needed to state was
     * silently absent. Every other editor in this workspace already derives it this way (recipes,
     * products, meals, plans, price lists); this is the odd one out being brought into line. The
     * mutation writes its answer straight into the detail cache entry, so the banner still appears
     * in the same frame a save quarantines the row.
     */
    const quarantined = record.data?.meta.status === 'review_required';
    /**
     * The version every write is based on, read from the cache at save time rather than held in
     * state. A mutation writes its answer into the detail entry, so this is always the newest
     * version this client has seen — and a version somebody *else* moved is exactly what produces
     * the conflict the dialog exists for.
     */
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's values still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== rowsKey && !rowsDirty) {
        setRowsKey(serverKey);
        setRows(rowsFrom(data));
    }

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    const markRowsDirty = () => {
        setRowsDirty(true);
        guard.markDirty();
    };

    const settle = (nextDetailsDirty: boolean, nextRowsDirty: boolean) => {
        setDetailsDirty(nextDetailsDirty);
        setRowsDirty(nextRowsDirty);
        if (!nextDetailsDirty && !nextRowsDirty) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setRowsDirty(false);
        setDetailsKey(null);
        setRowsKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    const classByCode = useMemo(() => {
        const map = new Map<string, AllergenClass>();
        for (const entry of classes.data ?? []) map.set(String(entry.code), entry);
        return map;
    }, [classes.data]);

    const classOptions: readonly SelectOption[] = useMemo(
        () =>
            (classes.data ?? [])
                .filter((entry) => entry.isActive)
                .map((entry) => ({
                    value: String(entry.code),
                    label: displayName(entry.name, locale).value,
                    description: String(entry.code),
                })),
        [classes.data, locale],
    );

    /**
     * Units, annotated by the dimension they belong to.
     *
     * Grouping matters because conversion only happens within a dimension (plan §4.5) — a picker
     * that offered grams and millilitres as one undifferentiated list would invite exactly the
     * choice the schema constraint exists to prevent. `Select` has no option-group API, so the
     * dimension travels in the option description and the list is ordered by it, which reads the
     * same way and needs no new design-system component.
     */
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            UNIT_DIMENSIONS.flatMap((dimension) =>
                MEASURE_UNITS.filter((unit) => unitDimension(unit) === dimension).map((unit) => ({
                    value: unit,
                    label: t(unitKey(unit)),
                    description: t(unitDimensionKey(dimension)),
                })),
            ),
        [t],
    );

    const categoryOptions: readonly SelectOption[] = useMemo(() => {
        const known = new Map<string, SelectOption>();
        for (const entry of categories.data ?? []) {
            known.set(entry.code, { value: entry.code, label: humaniseCode(entry.code) });
        }
        // The record's own code may not be in the derived vocabulary (the derivation reads one
        // page). Adding it keeps the Select from showing a placeholder over a real value.
        if (details.categoryCode !== '' && !known.has(details.categoryCode)) {
            known.set(details.categoryCode, {
                value: details.categoryCode,
                label: humaniseCode(details.categoryCode),
            });
        }
        return [...known.values()].sort((left, right) => left.label.localeCompare(right.label));
    }, [categories.data, details.categoryCode]);

    /* ── per-row validation ──────────────────────────────────────────────────────────────────── */

    const isPlatformLibrary = data?.organisationId === null;

    const rowErrors = useMemo(() => {
        const errors = new Map<string, string>();
        const seen = new Set<string>();

        for (const row of rows) {
            if (row.allergenCode === null) {
                errors.set(row.key, t('kitchen:allergens.chooseClass'));
                continue;
            }
            const code = String(row.allergenCode);
            if (seen.has(code)) {
                errors.set(row.key, t('kitchen:allergens.duplicateClass'));
                continue;
            }
            seen.add(code);

            if (!isPlatformLibrary || row.origin !== 'baseline' || row.baseline === null) {
                continue;
            }

            if (row.baseline.containment === 'contains' && row.containment === 'may_contain') {
                errors.set(row.key, t('kitchen:allergens.upgradeOnlyContainment'));
                continue;
            }
            if (verificationRank(row.verification) < verificationRank(row.baseline.verification)) {
                errors.set(row.key, t('kitchen:allergens.upgradeOnlyVerification'));
            }
        }

        return errors;
    }, [rows, isPlatformLibrary, t]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const nameMissing = details.name.en.trim() === '';
    const categoryMissing = details.categoryCode.trim() === '';

    const saveDetails = () => {
        if (nameMissing || categoryMissing) return;

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    categoryCode: details.categoryCode,
                    measurementUnit: details.measurementUnit,
                    ...(details.reference.trim() === ''
                        ? {}
                        : { reference: details.reference.trim() }),
                    ...(details.aliases.length === 0 ? {} : { aliases: details.aliases }),
                    ...(details.notes.trim() === '' ? {} : { notes: details.notes.trim() }),
                },
                {
                    onSuccess: (created) => {
                        settle(false, false);
                        toast.show({
                            testID: 'kitchen-ingredient-created-toast',
                            tone: 'success',
                            message: t('kitchen:editor.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`/kitchen/ingredients/${String(created.id)}` as never);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        update.mutate(
            {
                ingredientId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    categoryCode: details.categoryCode,
                    measurementUnit: details.measurementUnit,
                    reference: details.reference.trim() === '' ? null : details.reference.trim(),
                    aliases: details.aliases,
                    notes: details.notes.trim() === '' ? null : details.notes.trim(),
                },
            },
            {
                onSuccess: () => {
                    settle(false, rowsDirty);
                    toast.show({
                        testID: 'kitchen-ingredient-saved-toast',
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

    const saveMappings = () => {
        if (data === undefined || rowErrors.size > 0) return;

        const mappings: IngredientAllergenMapping[] = rows.flatMap((row) =>
            row.allergenCode === null
                ? []
                : [
                      {
                          allergenCode: row.allergenCode,
                          containment: row.containment,
                          marketScope: parseMarkets(row.marketScope),
                          verification: row.verification,
                          sourceNote: row.sourceNote.trim() === '' ? null : row.sourceNote.trim(),
                      },
                  ],
        );

        setAllergens.mutate(
            {
                ingredientId: data.id,
                request: { lockVersion: data.meta.lockVersion, mappings },
            },
            {
                onSuccess: (saved) => {
                    settle(detailsDirty, false);
                    toast.show({
                        testID: 'kitchen-ingredient-mapping-saved-toast',
                        tone: saved.meta.status === 'review_required' ? 'warning' : 'success',
                        message: t('kitchen:allergens.savedToast'),
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
            <Stack space="lg" testID="kitchen-ingredient-editor-screen">
                <Callout
                    testID="kitchen-ingredient-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:editor.notFoundTitle')}
                    body={t('kitchen:editor.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-ingredient-not-found-back"
                            variant="secondary"
                            label={t('kitchen:editor.backToList')}
                            onPress={() => {
                                router.push('/kitchen/ingredients' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-ingredient-editor-loading">
                <Skeleton testID="kitchen-ingredient-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-ingredient-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-ingredient-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-ingredient-editor-screen">
                <ErrorState
                    testID="kitchen-ingredient-load-error"
                    failure={loadFailure}
                    title={t('kitchen:editor.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    const mappingFailure = toFailure(setAllergens.error);

    return (
        <EditorFrame
            testID="kitchen-ingredient-editor-screen"
            title={isCreating ? t('kitchen:editor.createTitle') : t('kitchen:editor.editTitle')}
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={create.isPending || update.isPending}
            saveDisabled={!canManage || nameMissing || categoryMissing}
            backLabel={t('kitchen:editor.backToList')}
            onBack={() => {
                router.push('/kitchen/ingredients' as never);
            }}
            primaryAction={
                isCreating || !canManage || data?.meta.status === 'retired' ? null : (
                    <Button
                        testID="kitchen-ingredient-archive"
                        variant="secondary"
                        label={t('kitchen:editor.archive')}
                        onPress={() => {
                            setShowArchive(true);
                        }}
                    />
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-ingredient-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:allergens.quarantineTitle')}
                            body={t('kitchen:allergens.quarantineBody')}
                        />
                    ) : null}
                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-ingredient-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── details ──────────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-ingredient-details" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:editor.sectionDetails')}</Heading>

                    <BilingualField
                        testID="kitchen-ingredient-name"
                        fieldLabel={t('kitchen:fields.name')}
                        value={details.name}
                        requiredEnglish
                        {...(nameMissing ? { englishError: t('kitchen:editor.nameRequired') } : {})}
                        onChange={(next) => {
                            setDetails({ ...details, name: next });
                            markDetailsDirty();
                        }}
                    />
                </Stack>
            </Card>

            {/* ── classification ───────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-ingredient-classification" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:editor.sectionClassification')}</Heading>

                    <TextInputField
                        testID="kitchen-ingredient-reference"
                        id="kitchen-ingredient-reference"
                        label={t('kitchen:fields.reference')}
                        hint={t('kitchen:fields.referenceHint')}
                        value={details.reference}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        onChangeText={(next) => {
                            setDetails({ ...details, reference: next });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-ingredient-category"
                        id="kitchen-ingredient-category"
                        label={t('kitchen:fields.category')}
                        hint={t('kitchen:fields.categoryHint')}
                        placeholder={t('kitchen:fields.categoryPlaceholder')}
                        searchable
                        required
                        options={categoryOptions}
                        value={details.categoryCode === '' ? null : details.categoryCode}
                        {...(categoryMissing
                            ? { error: t('kitchen:editor.categoryRequired') }
                            : {})}
                        onChange={(next) => {
                            setDetails({ ...details, categoryCode: next });
                            markDetailsDirty();
                        }}
                    />

                    <Select
                        testID="kitchen-ingredient-unit"
                        id="kitchen-ingredient-unit"
                        label={t('kitchen:fields.unit')}
                        hint={t('kitchen:fields.unitHint')}
                        searchable
                        options={unitOptions}
                        value={details.measurementUnit}
                        onChange={(next) => {
                            setDetails({ ...details, measurementUnit: next as MeasureUnit });
                            markDetailsDirty();
                        }}
                    />

                    <TextInputField
                        testID="kitchen-ingredient-notes"
                        id="kitchen-ingredient-notes"
                        label={t('kitchen:fields.notes')}
                        hint={t('kitchen:fields.notesHint')}
                        value={details.notes}
                        multiline
                        numberOfLines={3}
                        onChangeText={(next) => {
                            setDetails({ ...details, notes: next });
                            markDetailsDirty();
                        }}
                    />
                </Stack>
            </Card>

            {/* ── aliases ──────────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-ingredient-aliases" padding="md">
                <Stack space="md">
                    <Stack space="xs">
                        <Heading level={2}>{t('kitchen:aliases.title')}</Heading>
                        <Text tone="secondary">{t('kitchen:aliases.description')}</Text>
                    </Stack>

                    {details.aliases.length === 0 ? (
                        <Text testID="kitchen-ingredient-aliases-empty" tone="secondary">
                            {t('kitchen:aliases.empty')}
                        </Text>
                    ) : (
                        <Inline space="xs" wrap testID="kitchen-ingredient-alias-list">
                            {details.aliases.map((alias) => (
                                <Chip
                                    key={alias}
                                    testID={`kitchen-ingredient-alias-${alias}`}
                                    label={alias}
                                    onRemove={
                                        canManage
                                            ? () => {
                                                  setDetails({
                                                      ...details,
                                                      aliases: details.aliases.filter(
                                                          (entry) => entry !== alias,
                                                      ),
                                                  });
                                                  setRemovedAlias(alias);
                                                  markDetailsDirty();
                                                  toast.show({
                                                      testID: 'kitchen-ingredient-alias-removed-toast',
                                                      tone: 'neutral',
                                                      message: t('kitchen:aliases.removedToast', {
                                                          alias,
                                                      }),
                                                  });
                                              }
                                            : undefined
                                    }
                                />
                            ))}
                        </Inline>
                    )}

                    {removedAlias === null ? null : (
                        <Inline space="sm" align="center" wrap>
                            <Text testID="kitchen-ingredient-alias-removed" variant="caption">
                                {t('kitchen:aliases.removedToast', { alias: removedAlias })}
                            </Text>
                            <Button
                                testID="kitchen-ingredient-alias-undo"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:common.undo')}
                                onPress={() => {
                                    setDetails({
                                        ...details,
                                        aliases: [...details.aliases, removedAlias],
                                    });
                                    setRemovedAlias(null);
                                    markDetailsDirty();
                                }}
                            />
                        </Inline>
                    )}

                    {canManage ? (
                        <Inline space="sm" align="end" wrap>
                            <Stack space="none" grow>
                                <TextInputField
                                    testID="kitchen-ingredient-alias-input"
                                    id="kitchen-ingredient-alias-input"
                                    label={t('kitchen:aliases.inputLabel')}
                                    placeholder={t('kitchen:aliases.inputPlaceholder')}
                                    value={aliasInput}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    {...(aliasError === null ? {} : { error: aliasError })}
                                    onChangeText={(next) => {
                                        setAliasInput(next);
                                        setAliasError(null);
                                    }}
                                />
                            </Stack>
                            <Button
                                testID="kitchen-ingredient-alias-add"
                                variant="secondary"
                                label={t('kitchen:aliases.add')}
                                disabled={aliasInput.trim() === ''}
                                onPress={() => {
                                    const alias = aliasInput.trim();
                                    if (alias === '') return;
                                    if (details.aliases.includes(alias)) {
                                        setAliasError(t('kitchen:aliases.duplicate'));
                                        return;
                                    }
                                    setDetails({
                                        ...details,
                                        aliases: [...details.aliases, alias],
                                    });
                                    setAliasInput('');
                                    setRemovedAlias(null);
                                    markDetailsDirty();
                                }}
                            />
                        </Inline>
                    ) : null}

                    <Text
                        testID="kitchen-ingredient-alias-count"
                        tone="secondary"
                        variant="caption"
                        role="status"
                        aria-live="polite"
                    >
                        {t('kitchen:aliases.count', { count: details.aliases.length })}
                    </Text>
                </Stack>
            </Card>

            {/* ── allergen mapping ─────────────────────────────────────────────────────────── */}
            {isCreating ? null : (
                <Card testID="kitchen-ingredient-allergens" padding="md">
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('kitchen:allergens.title')}</Heading>
                            <Text tone="secondary">{t('kitchen:allergens.description')}</Text>
                        </Stack>

                        <Callout
                            testID="kitchen-ingredient-allergen-safety"
                            role="note"
                            tone="warning"
                            title={t('kitchen:allergens.safetyTitle')}
                            body={t('kitchen:allergens.safetyBody')}
                        />

                        {classes.isPending ? (
                            <Skeleton
                                testID="kitchen-ingredient-allergen-loading"
                                heightClassName="h-24"
                            />
                        ) : classes.error !== null ? (
                            <Callout
                                testID="kitchen-ingredient-allergen-classes-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:allergens.classesError')}
                            />
                        ) : (
                            <Stack space="md">
                                {rows.length === 0 ? (
                                    <Stack space="xs" testID="kitchen-ingredient-allergen-empty">
                                        <Text tone="secondary">{t('kitchen:allergens.empty')}</Text>
                                        <Text tone="secondary" variant="caption">
                                            {t('kitchen:allergens.emptyHint')}
                                        </Text>
                                    </Stack>
                                ) : (
                                    rows.map((row, index) => {
                                        const rowTestId = `kitchen-ingredient-mapping-${row.key}`;
                                        const error = rowErrors.get(row.key);
                                        const isBaseline =
                                            isPlatformLibrary && row.origin === 'baseline';
                                        const patch = (next: Partial<MappingRow>) => {
                                            setRows(
                                                rows.map((entry) =>
                                                    entry.key === row.key
                                                        ? { ...entry, ...next }
                                                        : entry,
                                                ),
                                            );
                                            markRowsDirty();
                                        };

                                        return (
                                            <Card
                                                key={row.key}
                                                testID={rowTestId}
                                                padding="sm"
                                                tone={isBaseline ? 'sunken' : 'default'}
                                            >
                                                <Stack space="sm">
                                                    <Inline space="sm" align="center" wrap>
                                                        <Text variant="label">
                                                            {t('kitchen:allergens.rowTitle', {
                                                                index: index + 1,
                                                            })}
                                                        </Text>
                                                        {isBaseline ? (
                                                            <Badge
                                                                testID={`${rowTestId}-baseline`}
                                                                tone="info"
                                                                label={t(
                                                                    'kitchen:allergens.platformBaseline',
                                                                )}
                                                            />
                                                        ) : null}
                                                    </Inline>

                                                    {isBaseline ? (
                                                        <Text
                                                            testID={`${rowTestId}-baseline-hint`}
                                                            tone="secondary"
                                                            variant="caption"
                                                        >
                                                            {t(
                                                                'kitchen:allergens.platformBaselineHint',
                                                            )}
                                                        </Text>
                                                    ) : null}

                                                    {isBaseline ? (
                                                        <Stack space="none">
                                                            <Text variant="label">
                                                                {t('kitchen:allergens.classLabel')}
                                                            </Text>
                                                            <Text testID={`${rowTestId}-class`}>
                                                                {row.allergenCode === null
                                                                    ? ''
                                                                    : displayName(
                                                                          classByCode.get(
                                                                              String(
                                                                                  row.allergenCode,
                                                                              ),
                                                                          )?.name ?? {
                                                                              en: String(
                                                                                  row.allergenCode,
                                                                              ),
                                                                              ar: String(
                                                                                  row.allergenCode,
                                                                              ),
                                                                          },
                                                                          locale,
                                                                      ).value}
                                                            </Text>
                                                        </Stack>
                                                    ) : (
                                                        <Select
                                                            testID={`${rowTestId}-class`}
                                                            id={`${rowTestId}-class`}
                                                            label={t(
                                                                'kitchen:allergens.classLabel',
                                                            )}
                                                            placeholder={t(
                                                                'kitchen:allergens.classPlaceholder',
                                                            )}
                                                            searchable
                                                            required
                                                            disabled={!canManage}
                                                            options={classOptions}
                                                            value={
                                                                row.allergenCode === null
                                                                    ? null
                                                                    : String(row.allergenCode)
                                                            }
                                                            onChange={(next) => {
                                                                patch({
                                                                    allergenCode:
                                                                        next as AllergenCode,
                                                                });
                                                            }}
                                                        />
                                                    )}

                                                    <SegmentedControl
                                                        testID={`${rowTestId}-containment`}
                                                        label={t(
                                                            'kitchen:allergens.containmentLabel',
                                                        )}
                                                        block
                                                        value={row.containment}
                                                        onChange={(next) => {
                                                            patch({
                                                                containment:
                                                                    next as AllergenContainment,
                                                            });
                                                        }}
                                                        items={ALLERGEN_CONTAINMENTS.map(
                                                            (value) => ({
                                                                value,
                                                                label: t(containmentKey(value)),
                                                                disabled: !canManage,
                                                                testID: `${rowTestId}-containment-${value}`,
                                                            }),
                                                        )}
                                                    />

                                                    <Select
                                                        testID={`${rowTestId}-verification`}
                                                        id={`${rowTestId}-verification`}
                                                        label={t(
                                                            'kitchen:allergens.verificationLabel',
                                                        )}
                                                        disabled={!canManage}
                                                        options={ALLERGEN_VERIFICATIONS.map(
                                                            (value) => ({
                                                                value,
                                                                label: t(verificationKey(value)),
                                                            }),
                                                        )}
                                                        value={row.verification}
                                                        onChange={(next) => {
                                                            patch({
                                                                verification:
                                                                    next as AllergenVerification,
                                                            });
                                                        }}
                                                    />

                                                    <TextInputField
                                                        testID={`${rowTestId}-markets`}
                                                        id={`${rowTestId}-markets`}
                                                        label={t(
                                                            'kitchen:allergens.marketScopeLabel',
                                                        )}
                                                        hint={t(
                                                            'kitchen:allergens.marketScopeHint',
                                                        )}
                                                        placeholder={t(
                                                            'kitchen:allergens.marketScopeAll',
                                                        )}
                                                        value={row.marketScope}
                                                        autoCapitalize="characters"
                                                        autoCorrect={false}
                                                        disabled={!canManage}
                                                        onChangeText={(next) => {
                                                            patch({ marketScope: next });
                                                        }}
                                                    />

                                                    <TextInputField
                                                        testID={`${rowTestId}-evidence`}
                                                        id={`${rowTestId}-evidence`}
                                                        label={t('kitchen:allergens.evidenceLabel')}
                                                        hint={t('kitchen:allergens.evidenceHint')}
                                                        value={row.sourceNote}
                                                        disabled={!canManage}
                                                        onChangeText={(next) => {
                                                            patch({ sourceNote: next });
                                                        }}
                                                    />

                                                    {error === undefined ? null : (
                                                        <Callout
                                                            testID={`${rowTestId}-error`}
                                                            role="alert"
                                                            tone="danger"
                                                            title={error}
                                                        />
                                                    )}

                                                    {canManage ? (
                                                        <Inline space="sm" wrap justify="end">
                                                            <Button
                                                                testID={`${rowTestId}-remove`}
                                                                size="sm"
                                                                variant="ghost"
                                                                label={t(
                                                                    'kitchen:allergens.remove',
                                                                )}
                                                                onPress={() => {
                                                                    setRows(
                                                                        rows.filter(
                                                                            (entry) =>
                                                                                entry.key !==
                                                                                row.key,
                                                                        ),
                                                                    );
                                                                    markRowsDirty();
                                                                }}
                                                            />
                                                        </Inline>
                                                    ) : null}
                                                </Stack>
                                            </Card>
                                        );
                                    })
                                )}

                                {rowErrors.size === 0 ? null : (
                                    <Text
                                        testID="kitchen-ingredient-mapping-blocked"
                                        tone="danger"
                                        variant="caption"
                                    >
                                        {t('kitchen:allergens.saveBlocked')}
                                    </Text>
                                )}

                                {mappingFailure === null ? null : (
                                    <Callout
                                        testID="kitchen-ingredient-mapping-error"
                                        role="alert"
                                        tone="danger"
                                        title={t('kitchen:allergens.saveError')}
                                        body={mappingFailure.message}
                                    />
                                )}

                                {canManage ? (
                                    <Inline space="sm" wrap>
                                        <Button
                                            testID="kitchen-ingredient-mapping-add"
                                            variant="secondary"
                                            iconStart={<Icon name="plus" />}
                                            label={t('kitchen:allergens.addRow')}
                                            onPress={() => {
                                                setRows([
                                                    ...rows,
                                                    {
                                                        key: `overlay-${String(nextRowOrdinal)}`,
                                                        origin: 'overlay',
                                                        baseline: null,
                                                        allergenCode: null,
                                                        containment: 'contains',
                                                        marketScope: '',
                                                        verification: 'unverified',
                                                        sourceNote: '',
                                                    },
                                                ]);
                                                setNextRowOrdinal(nextRowOrdinal + 1);
                                                markRowsDirty();
                                            }}
                                        />
                                        <Button
                                            testID="kitchen-ingredient-mapping-save"
                                            label={t('kitchen:allergens.save')}
                                            loading={setAllergens.isPending}
                                            disabled={rowErrors.size > 0 || setAllergens.isPending}
                                            onPress={saveMappings}
                                        />
                                    </Inline>
                                ) : null}
                            </Stack>
                        )}
                    </Stack>
                </Card>
            )}

            {/*
             * ── archive confirmation ──────────────────────────────────────────────────────────
             *
             * The failure line renders the server's own sentence verbatim and deliberately says
             * nothing specific: the store does not yet refuse an archive for an ingredient a recipe
             * still uses, and when it does, that refusal arrives as a message this dialog already
             * shows rather than as a case this screen has to learn about.
             */}
            <Dialog
                testID="kitchen-ingredient-archive-dialog"
                open={showArchive}
                onClose={() => {
                    setShowArchive(false);
                }}
                title={t('kitchen:editor.archiveTitle')}
                description={t('kitchen:editor.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-ingredient-archive-cancel"
                            variant="secondary"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowArchive(false);
                            }}
                        />
                        <Button
                            testID="kitchen-ingredient-archive-confirm"
                            variant="danger"
                            label={t('kitchen:editor.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                archive.mutate(
                                    {
                                        ingredientId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (archived) => {
                                            setShowArchive(false);
                                            settle(false, false);
                                            toast.show({
                                                testID: 'kitchen-ingredient-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:list.archivedToast', {
                                                    name: displayName(archived.name, locale).value,
                                                }),
                                            });
                                            router.push('/kitchen/ingredients' as never);
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
                {archive.error === null ? null : (
                    <Text testID="kitchen-ingredient-archive-error" tone="danger">
                        {toFailure(archive.error)?.message ?? t('kitchen:list.archiveFailed')}
                    </Text>
                )}
            </Dialog>
        </EditorFrame>
    );
}
