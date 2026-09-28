import { Heading, Icon, Stack, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The parts the account pages share — `/profile` and `/devices`.
 *
 * ```
 * Your profile
 * What Healthy360 knows about your account.
 * ┌ Account ───────────────────────────────────────┐
 * │ Name            Layla Haddad                   │   <- FactGrid: two columns from `md`
 * │ Email address   layla@…                        │
 * └────────────────────────────────────────────────┘
 * ┌ Sign-in and security ──────────────────────────┐
 * │ [▣] Password            [ Change password ]    │   <- MarkTile leads each row
 * └────────────────────────────────────────────────┘
 * ```
 *
 * One column, at most 768px wide. These are pages somebody reads top to bottom, not a listing to
 * scan across, and a label at one edge of a 1400px card with its value at the other is a line the
 * eye has to walk.
 */
export interface SettingsPageProps {
    readonly title: string;
    readonly subtitle: string;
    /** Beside the opening, under the subtitle — an identity strip, a status. */
    readonly lead?: ReactNode | undefined;
    readonly children: ReactNode;
    /** Root `{testID}`, title `{testID}-title` unless `titleTestID` names it. */
    readonly testID: string;
    readonly titleTestID?: string | undefined;
}

export function SettingsPage({
    title,
    subtitle,
    lead,
    children,
    testID,
    titleTestID,
}: SettingsPageProps) {
    return (
        <Stack testID={testID} space="lg" className="w-full max-w-3xl">
            <Stack space="xs">
                <Heading level={1} testID={titleTestID ?? `${testID}-title`}>
                    {title}
                </Heading>
                <Text tone="secondary">{subtitle}</Text>
                {lead}
            </Stack>
            {children}
        </Stack>
    );
}

export interface Fact {
    readonly key: string;
    readonly label: string;
    readonly value: string;
    /** On the value, so a test reads what the reader reads. */
    readonly testID: string;
}

/**
 * Label over value, two to a row from `md`. Stacked rather than side by side because the labels
 * run from "Name" to "Two-factor authentication", and a label column sized for the longest leaves
 * the shortest adrift — the Arabic labels run longer again.
 */
export function FactGrid({ facts }: { readonly facts: readonly Fact[] }) {
    return (
        <View className="flex-row flex-wrap">
            {facts.map((fact) => (
                <View key={fact.key} className="w-full gap-0.5 py-2 pe-4 md:w-1/2">
                    <Text variant="caption" tone="secondary">
                        {fact.label}
                    </Text>
                    <Text testID={fact.testID}>{fact.value}</Text>
                </View>
            ))}
        </View>
    );
}

/** The square a settings row leads with: the mark on the sunken fill, the size of two lines. */
export function MarkTile({ name }: { readonly name: IconName }) {
    return (
        <View className="h-10 w-10 items-center justify-center rounded-md bg-surface-sunken">
            <Icon name={name} className="text-content-secondary" />
        </View>
    );
}
