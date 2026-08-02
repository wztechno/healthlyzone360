import { FilterChip, Inline, Select, Stack, Text, TextInputField } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ALLERGEN_CODES } from '../onboarding/vocabularies.ts';
import { ALLERGEN_SEVERITIES } from './dietary.ts';
import type { AllergenDeclaration, AllergenSeverity } from './repositories-shim.ts';

/**
 * The allergy declaration control.
 *
 * ## Why it lives in `features/account` and not in the wizard
 *
 * `DietaryProfile` is **the store of record** for what a person cannot eat
 * (`contracts/account.ts`). The onboarding wizard pre-fills from it and writes back to it; the meal
 * configurator prefers it to anything it holds locally. A control that edits the store of record
 * belongs with the store of record, and the two other surfaces import it — which is the opposite of
 * where this started, with the wizard owning a private tick-list and the account screen owning a
 * second one that could disagree with it about what a "severity" is.
 *
 * TODO(onboarding pre-fill wave): `features/onboarding/step-body.tsx` still renders its own
 * `ChipGroup` over `ALLERGEN_CODES` and stores bare codes with no severity. That wave replaces the
 * wizard's allergy and diet steps with {@link AllergyPicker} and
 * {@link import('./dietary-tags-picker.tsx').DietaryTagsPicker}, seeds them from
 * `useDietaryProfileQuery()`, and writes back through `useSaveDietaryProfileMutation()`. J1
 * deliberately does **not** touch the 22-step wizard: changing a step's shape and changing where
 * its answers are stored are two migrations, and doing both in one slice is how a person's declared
 * allergies get silently dropped between them.
 *
 * ## Severity is asked, not assumed
 *
 * Ticking an allergen declares it at `allergy` — the strictest reading, and the only one the
 * configurator treats as a hard exclusion. A person may then soften it to `intolerance` or
 * `avoidance`. Defaulting the other way round would mean a mis-tap quietly downgraded a safety
 * constraint to a preference, and the failure would be invisible until a meal arrived.
 *
 * ## The tick-list is a vocabulary, not data
 *
 * The fourteen codes are the published labelling groups of the EU, UK and GCC regimes — part of the
 * contract rather than anybody's product decision — so they are read from
 * `features/onboarding/vocabularies.ts`, which is where this codebase already keeps them, rather
 * than fetched. A `GET /api/v1/reference/allergens` would replace the import and change nothing
 * else; the gap is already recorded in that module.
 *
 * The labels are `onboarding:allergens.*` for the same reason: they are already authored in both
 * locales, and a second copy under `account:` would be two sets of words for one legal vocabulary,
 * free to drift.
 */
export interface AllergyPickerProps {
    readonly value: readonly AllergenDeclaration[];
    readonly onChange: (next: readonly AllergenDeclaration[]) => void;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function AllergyPicker({
    value,
    onChange,
    disabled = false,
    testID = 'allergy-picker',
}: AllergyPickerProps) {
    const { t } = useTranslation();
    const declared = new Map(value.map((entry) => [entry.allergenCode, entry]));

    const toggle = (code: string) => {
        onChange(
            declared.has(code)
                ? value.filter((entry) => entry.allergenCode !== code)
                : [...value, { allergenCode: code, severity: 'allergy', note: null }],
        );
    };

    const amend = (code: string, patch: Partial<AllergenDeclaration>) => {
        onChange(
            value.map((entry) => (entry.allergenCode === code ? { ...entry, ...patch } : entry)),
        );
    };

    const groupLabel = t('account:dietary.allergensTitle');

    return (
        <Stack space="sm" testID={testID}>
            <Text variant="label" testID={`${testID}-label`}>
                {groupLabel}
            </Text>
            <Text variant="caption" tone="secondary">
                {t('account:dietary.severityHint')}
            </Text>

            {/*
             * `role="group"` with a name around toggle buttons — the same pattern the wizard uses.
             * `FilterChip` already announces `aria-pressed` / `accessibilityState.selected`, so a
             * listbox would only add owned-element rules to get wrong.
             */}
            <View role="group" aria-label={groupLabel} accessibilityLabel={groupLabel}>
                <Inline space="xs" wrap>
                    {ALLERGEN_CODES.map((code) => (
                        <FilterChip
                            key={code}
                            testID={`${testID}-${code}`}
                            label={t(`onboarding:allergens.${code}`)}
                            selected={declared.has(code)}
                            disabled={disabled}
                            onChange={() => {
                                toggle(code);
                            }}
                        />
                    ))}
                </Inline>
            </View>

            {value.length === 0 ? (
                <Text variant="caption" tone="secondary" testID={`${testID}-empty`}>
                    {t('account:dietary.allergensEmpty')}
                </Text>
            ) : null}

            {value.map((entry) => (
                <Stack
                    key={entry.allergenCode}
                    space="xs"
                    testID={`${testID}-row-${entry.allergenCode}`}
                >
                    <Select<AllergenSeverity>
                        testID={`${testID}-severity-${entry.allergenCode}`}
                        label={t('account:dietary.severityFor', {
                            allergen: t(`onboarding:allergens.${entry.allergenCode}`),
                        })}
                        value={entry.severity}
                        disabled={disabled}
                        options={ALLERGEN_SEVERITIES.map((severity) => ({
                            value: severity,
                            label: t(`account:dietary.severity.${severity}`),
                        }))}
                        onChange={(severity) => {
                            amend(entry.allergenCode, { severity });
                        }}
                    />
                    <TextInputField
                        testID={`${testID}-note-${entry.allergenCode}`}
                        label={t('account:dietary.noteLabel')}
                        value={entry.note ?? ''}
                        disabled={disabled}
                        onChangeText={(note: string) => {
                            // Empty is `null`, not `''`: the contract's note is "there is a note or
                            // there is not", and an empty string is a third state nothing reads.
                            amend(entry.allergenCode, { note: note.trim() === '' ? null : note });
                        }}
                    />
                </Stack>
            ))}
        </Stack>
    );
}
