import type {
    AllergenClass,
    AllergenReferenceSelection,
    AllergenContainment,
    IngredientAdmin,
    IngredientAllergenMapping,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Checkbox,
    Inline,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    useSetIngredientAllergensMutation,
    useImportIngredientAllergenReference,
    useConfirmIngredientAllergensMutation,
} from '../../data/kitchen-admin-hooks.ts';
import { AllergenChoiceRow } from './allergen-choice-row.tsx';
import type { AllergenChoice } from './allergen-choice-row.tsx';
import { AllergenMappingList } from './allergen-mapping-list.tsx';
import { AllergenReferencePicker } from './allergen-reference-picker.tsx';
import { AllergenReferenceSource } from './allergen-reference-source.tsx';
import { displayName } from './format.ts';
import { serverFieldErrors } from './server-field-errors.ts';

type Choice = AllergenChoice;

export interface IngredientAllergenEditorProps {
    readonly ingredient: IngredientAdmin;
    readonly classes: readonly AllergenClass[];
    /**
     * Told whenever the draft gains or loses unsaved choices. The page's own Save does not write
     * this set, and its save remounts this editor, so without it a change here was lost (HA-39).
     */
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
    /**
     * Leave "not assessed" unsaid here: the ingredient editor says it once, in its issue tray, with
     * the way to this section.
     */
    readonly hideUnassessed?: boolean | undefined;
}

/**
 * The ingredient's allergen determination, editable: one choice per active class, saved as the
 * whole set (`PUT …/allergens` is wholesale).
 *
 * An empty set is a claim — "assessed, carries nothing" — so its button says so rather than
 * "save", and the server records it on the ingredient for the publish gate. A mapping the server
 * already holds keeps its verification and evidence; only the containment is chosen here. The
 * upgrade-only refusal on a platform baseline comes back as an error and is shown as one.
 *
 * Mount it keyed by the stored set so a successful save re-reads the server's answer.
 */
export function IngredientAllergenEditor({
    ingredient,
    classes,
    onDirtyChange,
    hideUnassessed = false,
}: IngredientAllergenEditorProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const toast = useToast();
    const save = useSetIngredientAllergensMutation();
    const importReference = useImportIngredientAllergenReference();
    const [selection, setSelection] = useState<AllergenReferenceSelection | undefined>();
    const confirm = useConfirmIngredientAllergensMutation();
    const [evidence, setEvidence] = useState('');
    const [supplierEvidence, setSupplierEvidence] = useState('');
    // The classes the last save sent, in order: `mappings.2.…` in a refusal is the third of these.
    const [sentCodes, setSentCodes] = useState<readonly string[]>([]);
    // A barcode found the product and it declares nothing: the fourteen boxes fold into one ticked
    // "no allergens" box, as on the new-ingredient form. Unticking it brings them back.
    const [nothingDeclared, setNothingDeclared] = useState(false);
    const needsSupplier = ingredient.allergens.some(
        (mapping) =>
            mapping.verification === 'requires_supplier_confirmation' &&
            (mapping.layer !== 'platform_baseline' ||
                (ingredient.organisationId === null && ingredient.isEditable)),
    );

    const stored = new Map(ingredient.allergens.map((m) => [String(m.allergenCode), m]));
    const [draft, setDraft] = useState<ReadonlyMap<string, Choice>>(
        () => new Map(ingredient.allergens.map((m) => [String(m.allergenCode), m.containment])),
    );

    const active = classes.filter((entry) => entry.isActive || draft.has(String(entry.code)));
    const chosen = [...draft].filter(([, choice]) => choice !== 'none');
    const dirty =
        chosen.length !== stored.size ||
        chosen.some(([code, choice]) => stored.get(code)?.containment !== choice);
    const assessed = ingredient.allergens.length > 0 || ingredient.allergensAssessedClear === true;
    // Allergens found for the kitchen — by the master list or the reference lookup — are the
    // record; the boxes would only offer to undo it.
    const fromLookup = ingredient.allergens.some(
        (mapping) =>
            mapping.lookupSource != null ||
            mapping.source === 'master_list' ||
            mapping.source === 'inferred',
    );

    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    // A remount (the record moved on) starts clean; say so as this one goes.
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const onSave = () => {
        const mappings: IngredientAllergenMapping[] = [];
        for (const entry of active) {
            const code = String(entry.code);
            const choice = draft.get(code) ?? 'none';
            if (choice === 'none') continue;
            const previous = stored.get(code);
            mappings.push({
                allergenCode: entry.code,
                containment: choice,
                marketScope: previous?.marketScope ?? [],
                verification: previous?.verification ?? 'operator_confirmed',
                sourceNote: previous?.sourceNote ?? null,
            });
        }
        setSentCodes(mappings.map((mapping) => String(mapping.allergenCode)));
        save.mutate(
            {
                ingredientId: ingredient.id,
                request: { lockVersion: ingredient.meta.lockVersion, mappings },
            },
            {
                onSuccess: () => {
                    toast.show({
                        testID: 'kitchen-ingredient-mapping-saved-toast',
                        tone: 'success',
                        message: t('kitchen:allergens.savedToast'),
                    });
                },
            },
        );
    };

    const namesOf = (containment: AllergenContainment): string =>
        active
            .filter((entry) => draft.get(String(entry.code)) === containment)
            .map((entry) => displayName(entry.name, locale).value)
            .join(t('kitchen:allergenBoard.summaryJoin'));
    const containsNames = namesOf('contains');
    const mayNames = namesOf('may_contain');
    const summary =
        [
            containsNames === ''
                ? null
                : t('kitchen:allergenBoard.summaryContains', { names: containsNames }),
            mayNames === '' ? null : t('kitchen:allergenBoard.mayContain', { allergen: mayNames }),
        ]
            .filter((part): part is string => part !== null)
            .join(t('kitchen:recordView.metaSeparator')) || t('kitchen:allergenBoard.summaryNone');

    const failure = toFailure(save.error ?? confirm.error ?? importReference.error);
    // What the server refused, put on the fields it named (BUG-06). No issue banner here, so the
    // callout stays and carries only what no field shows.
    const server = serverFieldErrors(failure, {
        'mappings.*.allergen_code': {
            label: t('kitchen:allergens.classLabel'),
            fieldId: 'kitchen-ingredient-mapping-grid',
        },
        'mappings.*.containment': {
            label: t('kitchen:allergens.classLabel'),
            fieldId: 'kitchen-ingredient-mapping-grid',
        },
        evidence: {
            label: t('kitchen:nutritionLookup.reviewEvidence'),
            fieldId: 'allergen-review-evidence',
        },
        supplier_evidence: {
            label: t('kitchen:nutritionLookup.supplierEvidence'),
            fieldId: 'allergen-supplier-evidence',
        },
    });
    const mappingFlag = (code: string): { readonly error?: string } => {
        const index = sentCodes.indexOf(code);
        if (index < 0) return {};
        const at = `mappings.${String(index)}`;
        const error =
            server.errorFor(`${at}.containment`) ?? server.errorFor(`${at}.allergen_code`);
        return error === undefined ? {} : { error };
    };

    return (
        <Stack space="sm" testID="kitchen-ingredient-mapping">
            {ingredient.allergenReviewRequired ? (
                <Callout tone="warning" title={t('kitchen:nutritionLookup.reviewChanged')} />
            ) : null}
            {/* Once the set is recorded the lookup has done its job; it comes back only when a
                changed nutrition reference asks for the allergens to be looked at again. */}
            {ingredient.nutritionDerivedFromVersionId === null &&
            (!assessed || ingredient.allergenReviewRequired) ? (
                <AllergenReferencePicker
                    name={ingredient.name.en}
                    classes={classes}
                    value={selection}
                    onChange={setSelection}
                    disabled={
                        dirty || save.isPending || confirm.isPending || importReference.isPending
                    }
                    onNothingDeclared={() => setNothingDeclared(true)}
                />
            ) : null}
            {selection === undefined ? null : (
                <Button
                    testID="allergen-reference-import"
                    label={t('kitchen:allergenLookup.import')}
                    loading={importReference.isPending}
                    disabled={
                        dirty ||
                        save.isPending ||
                        confirm.isPending ||
                        importReference.isPending ||
                        !selection.confirmed ||
                        selection.candidate.selection_token === null ||
                        ingredient.allergenReviewToken == null
                    }
                    onPress={() => {
                        if (
                            selection.candidate.selection_token === null ||
                            ingredient.allergenReviewToken == null
                        )
                            return;
                        importReference.mutate(
                            {
                                ingredientId: ingredient.id,
                                request: {
                                    selectionToken: selection.candidate.selection_token,
                                    reviewToken: ingredient.allergenReviewToken,
                                    confirmed: true,
                                },
                            },
                            { onSuccess: () => setSelection(undefined) },
                        );
                    }}
                />
            )}
            {assessed || hideUnassessed ? null : (
                <Callout
                    testID="kitchen-ingredient-mapping-unassessed"
                    tone="warning"
                    title={t('kitchen:allergens.notAssessed')}
                />
            )}
            {/* Checked and empty is a claim, so it is said plainly rather than left as fourteen
                "Not present" boxes for the reader to add up. */}
            {ingredient.allergens.length === 0 && ingredient.allergensAssessedClear === true ? (
                <Callout
                    testID="kitchen-ingredient-mapping-clear"
                    tone="success"
                    title={t('kitchen:allergens.assessedClear')}
                />
            ) : null}

            {[
                ...new Map(
                    ingredient.allergens
                        .filter((mapping) => mapping.lookupSource != null)
                        .map((mapping) => [
                            String(mapping.lookupSource?.['source_hash']),
                            mapping.lookupSource,
                        ]),
                ).entries(),
            ].map(([hash, source]) =>
                source == null ? null : <AllergenReferenceSource key={hash} source={source} />,
            )}
            {ingredient.allergens.length === 0 ? null : (
                <AllergenMappingList
                    testID="ingredient-allergen-recorded"
                    mappings={ingredient.allergens}
                    classes={classes}
                    footer={
                        /*
                         * The review with evidence is for mappings someone has to stand behind. An
                         * empty set has none: "Confirm no allergens" is its whole confirmation, and a
                         * second checkbox saying the same thing was a second way to answer one
                         * question.
                         */
                        ingredient.allergenReviewToken == null ? undefined : (
                            <Stack space="sm" testID="ingredient-allergen-confirmation">
                                {needsSupplier ? (
                                    <TextInputField
                                        testID="allergen-supplier-evidence"
                                        id="allergen-supplier-evidence"
                                        label={t('kitchen:nutritionLookup.supplierEvidence')}
                                        value={supplierEvidence}
                                        onChangeText={setSupplierEvidence}
                                        maxLength={2000}
                                        {...server.flag('supplier_evidence')}
                                    />
                                ) : null}
                                <Inline space="xs" align="end">
                                    <View className="min-w-0 flex-1">
                                        <TextInputField
                                            testID="allergen-review-evidence"
                                            id="allergen-review-evidence"
                                            label={t('kitchen:nutritionLookup.reviewEvidence')}
                                            value={evidence}
                                            onChangeText={setEvidence}
                                            maxLength={2000}
                                            {...server.flag('evidence')}
                                        />
                                    </View>
                                    {/* `Button` holds itself to the top; the wrapper lines it up
                                        with the input box. */}
                                    <View>
                                        <Button
                                            testID="allergen-review-confirm"
                                            variant="primary"
                                            label={t('kitchen:nutritionLookup.confirmReview')}
                                            loading={confirm.isPending}
                                            disabled={
                                                dirty ||
                                                save.isPending ||
                                                importReference.isPending ||
                                                confirm.isPending ||
                                                evidence.trim() === '' ||
                                                (needsSupplier && supplierEvidence.trim() === '')
                                            }
                                            onPress={() =>
                                                confirm.mutate({
                                                    ingredientId: ingredient.id,
                                                    request: {
                                                        reviewToken:
                                                            ingredient.allergenReviewToken!,
                                                        evidence: evidence.trim(),
                                                        ...(needsSupplier
                                                            ? {
                                                                  supplierEvidence:
                                                                      supplierEvidence.trim(),
                                                              }
                                                            : {}),
                                                        confirmNoAllergens: false,
                                                    },
                                                })
                                            }
                                        />
                                    </View>
                                </Inline>
                                {dirty ? (
                                    <Text tone="secondary">
                                        {t('kitchen:nutritionLookup.saveMappingsFirst')}
                                    </Text>
                                ) : null}
                            </Stack>
                        )
                    }
                />
            )}
            {fromLookup ? null : nothingDeclared && chosen.length === 0 ? (
                <Checkbox
                    testID="kitchen-ingredient-mapping-none"
                    label={t('kitchen:allergens.createNone')}
                    checked
                    onChange={() => setNothingDeclared(false)}
                />
            ) : (
                <Stack space="xs">
                    {/* What the rows below add up to, so the set can be read before it is saved. */}
                    <View className="items-end">
                        <Text
                            testID="kitchen-ingredient-mapping-summary"
                            variant="label"
                            tone={chosen.length === 0 ? 'secondary' : 'warning'}
                        >
                            {summary}
                        </Text>
                    </View>
                    <View
                        testID="kitchen-ingredient-mapping-grid"
                        nativeID="kitchen-ingredient-mapping-grid"
                        className="flex-row flex-wrap gap-x-5 gap-y-1.5"
                    >
                        {active.map((entry) => {
                            const code = String(entry.code);
                            return (
                                <AllergenChoiceRow
                                    key={code}
                                    testID={`kitchen-ingredient-mapping-${code}`}
                                    nativeID={`kitchen-ingredient-mapping-${code}`}
                                    name={displayName(entry.name, locale).value}
                                    value={draft.get(code) ?? 'none'}
                                    {...mappingFlag(code)}
                                    onChange={(choice) => {
                                        setDraft((current) => new Map(current).set(code, choice));
                                    }}
                                />
                            );
                        })}
                    </View>
                </Stack>
            )}

            {failure === null ? null : (
                <Callout
                    testID="kitchen-ingredient-mapping-error"
                    tone="danger"
                    title={t('kitchen:allergens.saveError')}
                    body={server.unplaced ?? failure.message}
                />
            )}

            {fromLookup ? null : (
                <Inline justify="end">
                    <Button
                        testID="kitchen-ingredient-mapping-save"
                        variant="primary"
                        size="sm"
                        loading={save.isPending}
                        disabled={
                            save.isPending ||
                            importReference.isPending ||
                            confirm.isPending ||
                            (!dirty && assessed)
                        }
                        label={
                            chosen.length === 0
                                ? t('kitchen:allergens.confirmNone')
                                : t('kitchen:allergens.save')
                        }
                        onPress={onSave}
                    />
                </Inline>
            )}
        </Stack>
    );
}
