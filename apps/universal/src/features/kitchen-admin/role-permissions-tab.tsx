import type { PermissionDomain } from '@healthy360/api-client/contracts';
import { Badge, Card, Checkbox, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

/**
 * The Advanced tab — every code a role can hold, grouped as the backend groups them.
 *
 * ## It shows a code the administrator does not hold, marked rather than hidden
 *
 * Role management on this platform is total: whoever may edit roles may grant any organisation code,
 * including ones they cannot exercise themselves. That was a deliberate call, and `heldByCaller` is
 * what keeps it an informed one — granting an authority you do not have stays possible and stops
 * being accidental. Hiding those rows would have made the tab lie about what a role could hold;
 * disabling them would have made the product refuse something the server permits.
 *
 * ## Grouped by the server's `domain`, not by a prefix of the code
 *
 * `permissions.domain` is a column the backend seeds from its own registry. Deriving the grouping
 * here from the text before the dot would be the same grouping computed twice, and would disagree
 * the first time a domain and a prefix differed.
 *
 * ## The label falls back to the server's description
 *
 * A code this client has no string for renders with the English text the API sent, not as a blank
 * row — the rule `Invitation.roleCode` settles on next door. A permission added on the backend
 * tomorrow is therefore grantable today.
 */

export interface RolePermissionsTabProps {
    readonly domains: readonly PermissionDomain[];
    readonly codes: ReadonlySet<string>;
    readonly onChange: (codes: ReadonlySet<string>) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

export function RolePermissionsTab({
    domains,
    codes,
    onChange,
    disabled = false,
    testID,
}: RolePermissionsTabProps) {
    const { t } = useTranslation();

    const total = domains.reduce((count, domain) => count + domain.permissions.length, 0);
    const selected = domains.reduce(
        (count, domain) =>
            count + domain.permissions.filter((permission) => codes.has(permission.code)).length,
        0,
    );

    function toggle(code: string, on: boolean) {
        const next = new Set(codes);
        if (on) next.add(code);
        else next.delete(code);
        onChange(next);
    }

    return (
        <Stack space="lg" testID={testID}>
            <Inline space="sm" align="center" justify="between" wrap>
                <Text tone="secondary">{t('accessAdmin:advanced.hint')}</Text>
                <Text testID={`${testID}-selected`}>
                    {t('accessAdmin:advanced.selected', { count: selected, total })}
                </Text>
            </Inline>

            {domains.map((domain) => (
                <Card key={domain.domain} padding="md" testID={`${testID}-domain-${domain.domain}`}>
                    <Stack space="sm">
                        <Heading level={3}>{domain.domain}</Heading>

                        {domain.permissions.length === 0 ? (
                            <Text tone="secondary">{t('accessAdmin:advanced.emptyDomain')}</Text>
                        ) : (
                            domain.permissions.map((permission) => (
                                <Stack key={permission.code} space="none">
                                    <Checkbox
                                        testID={`${testID}-code-${permission.code}`}
                                        label={t(
                                            `accessAdmin:codes.${permission.code}.name` as never,
                                            { defaultValue: permission.description },
                                        )}
                                        description={permission.description}
                                        checked={codes.has(permission.code)}
                                        disabled={disabled}
                                        onChange={(on) => {
                                            toggle(permission.code, on);
                                        }}
                                    />
                                    {permission.heldByCaller ? null : (
                                        <Badge
                                            testID={`${testID}-not-held-${permission.code}`}
                                            tone="warning"
                                            label={t('accessAdmin:advanced.notHeld')}
                                        />
                                    )}
                                </Stack>
                            ))
                        )}
                    </Stack>
                </Card>
            ))}
        </Stack>
    );
}
