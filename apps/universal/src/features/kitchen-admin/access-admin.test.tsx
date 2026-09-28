import type {
    OrganisationRole,
    OrganisationRoleSummary,
    PermissionDomain,
    StaffInvitation,
    TeamMemberSummary,
} from '@healthy360/api-client/contracts';
import { ApiError, apiFailure, conflictFailure } from '@healthy360/api-client/contracts';
import { BranchId, MembershipId, RoleId, UserId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    permissionsAdministratorSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { RoleEditorScreen } from './screens/role-editor-screen.tsx';
import { TeamMemberScreen } from './screens/team-member-screen.tsx';
import { RolesScreen } from './screens/roles-screen.tsx';
import { StaffCreateScreen } from './screens/staff-create-screen.tsx';
import { TeamScreen } from './screens/team-screen.tsx';

/*
 * The access console, rendered.
 *
 * Two claims are worth more than the rest and are asserted rather than implied:
 *
 *  - **a platform template offers Copy and never Edit**, because the server answers 404 to an edit
 *    and a door that slams is worse than one that is not drawn;
 *  - **the Pages tab does not silently drop what it cannot show.** A role holding
 *    `recipe.publish_organisation` — a code no page names — must still hold it after a save made
 *    entirely on that tab, and the tab must say so rather than merely doing it.
 */

/*
 * The access console is a desk surface: at desk width its lists draw every column and the row's
 * actions as buttons. Jest's default window is phone-sized, where the same lists collapse to
 * two-line rows with the actions behind an overflow menu.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const back = jest.fn();
    return {
        useRouter: () => ({ push, replace, back }),
        useLocalSearchParams: () => (globalThis as { __params?: unknown }).__params ?? {},
        Redirect: () => null,
        __push: push,
        __replace: replace,
        __back: back,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as {
    __push: jest.Mock;
    __replace: jest.Mock;
    __back: jest.Mock;
};

function setParams(params: Record<string, string>) {
    (globalThis as { __params?: unknown }).__params = params;
}

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    routerMock.__back.mockClear();
    setParams({});
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/** A team member opens on Roles; Where they work and What that adds up to are the next two steps. */
async function openMemberStep(step: 'roles' | 'scope' | 'permissions') {
    await untilVisible('kitchen-team-member-tabs');
    await act(async () => {
        fireEvent.press(screen.getByTestId(`kitchen-team-member-tabs-tab-${step}`));
    });
}

/** Advanced is the role editor's last step, where Next becomes Save role. */
async function openRoleAdvancedStep() {
    await untilVisible('kitchen-role-editor-tabs');
    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-role-editor-tabs-tab-advanced'));
    });
}

/** The role editor opens on its Details step; Pages is the second of its three. */
async function openRolePagesStep() {
    await untilVisible('kitchen-role-editor-tabs');
    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-role-editor-tabs-tab-pages'));
    });
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const ROLE_ID = RoleId.unsafe('01935f6c-0000-7000-8000-0000000000a1');
const TEMPLATE_ID = RoleId.unsafe('01935f6c-0000-7000-8000-0000000000a2');
const MEMBERSHIP_ID = MembershipId.unsafe('01935f6c-0000-7000-8000-0000000000b1');

function roleSummary(overrides: Partial<OrganisationRoleSummary> = {}): OrganisationRoleSummary {
    return {
        id: ROLE_ID,
        code: 'evening_counter',
        nameEn: 'Evening counter',
        nameAr: 'كاونتر المساء',
        descriptionEn: 'Works the till after five.',
        descriptionAr: null,
        isSystem: false,
        holderCount: 2,
        permissionCount: 3,
        lockVersion: 0,
        updatedAt: null,
        ...overrides,
    };
}

function template(): OrganisationRoleSummary {
    return roleSummary({
        id: TEMPLATE_ID,
        code: 'kitchen_manager',
        nameEn: 'Kitchen manager',
        nameAr: 'مدير المطبخ',
        descriptionEn: null,
        isSystem: true,
        holderCount: 1,
        permissionCount: 28,
    });
}

function role(overrides: Partial<OrganisationRole> = {}): OrganisationRole {
    return {
        ...roleSummary(),
        permissions: ['order.manage_organisation', 'order.view_organisation'],
        updatedByName: 'Layla Haddad',
        ...overrides,
    };
}

function member(overrides: Partial<TeamMemberSummary> = {}): TeamMemberSummary {
    return {
        membershipId: MEMBERSHIP_ID,
        userId: UserId.unsafe('01935f6c-0000-7000-8000-0000000000c1'),
        givenName: 'Ahmad',
        familyName: 'Khalil',
        email: 'ahmad.khalil@verdant.test',
        status: 'active',
        joinedAt: '2026-01-15T09:30:00.000Z',
        branch: { id: BranchId.unsafe('01935f6c-0000-7000-8000-0000000000d1'), name: 'Hamra' },
        roles: [
            {
                id: ROLE_ID,
                code: 'evening_counter',
                nameEn: 'Evening counter',
                nameAr: 'كاونتر',
                isSystem: false,
            },
        ],
        lockVersion: 0,
        ...overrides,
    };
}

function invitation(): StaffInvitation {
    return {
        id: 'inv-1',
        email: 'new.starter@verdant.test',
        roleCode: 'kitchen_staff',
        status: 'live',
        expiresAt: '2026-02-01T09:30:00.000Z',
        createdAt: '2026-01-15T09:30:00.000Z',
    };
}

const CATALOGUE: readonly PermissionDomain[] = [
    {
        domain: 'order',
        permissions: [
            { code: 'order.view_organisation', description: 'View the orders', heldByCaller: true },
            {
                code: 'order.manage_organisation',
                description: 'Confirm, fulfil and cancel',
                heldByCaller: true,
            },
        ],
    },
    {
        domain: 'inventory',
        permissions: [
            {
                code: 'inventory.view_costs_organisation',
                description: 'View inventory costs',
                // The affordance the total-role-management decision needs: marked, not hidden.
                heldByCaller: false,
            },
        ],
    },
];

/** The role editor's world: one bespoke role and the vocabulary it is written in. */
function editorRepositories(overrides: Record<string, unknown> = {}) {
    return {
        accessAdmin: {
            getRole: jest.fn().mockResolvedValue(role()),
            listPermissions: jest.fn().mockResolvedValue(CATALOGUE),
            ...overrides,
        },
    };
}

/* ── the team list ────────────────────────────────────────────────────────────────────────────── */

describe('the team list', () => {
    it('shows people, their roles and where they work', async () => {
        await renderStubScreen(<TeamScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listTeam: jest.fn().mockResolvedValue(page([member()])),
                    listInvitations: jest.fn().mockResolvedValue([]),
                },
            },
        });

        await untilVisible('kitchen-team-table');

        expect(screen.getByTestId(`kitchen-team-row-${String(MEMBERSHIP_ID)}-name`)).toBeTruthy();
        expect(
            screen.getByTestId(`kitchen-team-row-${String(MEMBERSHIP_ID)}-role-evening_counter`),
        ).toBeTruthy();
        expect(screen.getByTestId(`kitchen-team-row-${String(MEMBERSHIP_ID)}-scope`)).toBeTruthy();
    });

    it('falls back to the address when a provisioned account has no profile yet', async () => {
        // An account opened by an administrator has a login before it has a name. A blank first
        // column would read as a bug rather than as a new starter.
        await renderStubScreen(<TeamScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listTeam: jest
                        .fn()
                        .mockResolvedValue(page([member({ givenName: null, familyName: null })])),
                    listInvitations: jest.fn().mockResolvedValue([]),
                },
            },
        });

        await untilVisible('kitchen-team-table');

        expect(
            screen.getByTestId(`kitchen-team-row-${String(MEMBERSHIP_ID)}-name`).props.children,
        ).toBe('ahmad.khalil@verdant.test');
    });

    it('asks for active people only until the filter widens it', async () => {
        const listTeam = jest.fn().mockResolvedValue(page([member()]));

        await renderStubScreen(<TeamScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: { listTeam, listInvitations: jest.fn().mockResolvedValue([]) },
            },
        });

        await untilVisible('kitchen-team-table');
        // The second argument: `listTeam(organisation, filter)`.
        expect(listTeam.mock.calls[0]?.[1]).toMatchObject({ status: 'active' });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-toolbar-status-everyone'));
        });

        await waitFor(() => {
            // The *latest* call, not "some call": the first one carried `status: 'active'` and
            // would satisfy a loose matcher for ever.
            expect(listTeam.mock.calls.at(-1)?.[1]).not.toHaveProperty('status');
        });
    });

    it('renders no invitation panel at all when there are none', async () => {
        // Nothing rather than an empty box: a kitchen with no outstanding offers should see a staff
        // list, not a staff list and a heading explaining that there is nothing under it.
        await renderStubScreen(<TeamScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listTeam: jest.fn().mockResolvedValue(page([member()])),
                    listInvitations: jest.fn().mockResolvedValue([]),
                },
            },
        });

        await untilVisible('kitchen-team-table');

        expect(screen.queryByTestId('kitchen-team-invitations')).toBeNull();
    });

    it('shows outstanding invitations beside the staff list', async () => {
        await renderStubScreen(<TeamScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listTeam: jest.fn().mockResolvedValue(page([member()])),
                    listInvitations: jest.fn().mockResolvedValue([invitation()]),
                },
            },
        });

        await untilVisible('kitchen-team-invitations');

        expect(screen.getByTestId('kitchen-team-invitation-inv-1-email')).toBeTruthy();
    });

    it('refuses somebody who cannot read the staff list', async () => {
        await renderStubScreen(<TeamScreen />, {
            // The organisation stays: with no context the *area* gate redirects rather than
            // denies, and the test would be asserting a forbidden page the screen never reaches.
            // What is narrowed is the one code this screen is gated on.
            session: permissionsAdministratorSession({
                activeContext: testActiveContext({
                    permissions: ['catalogue.view_organisation'],
                }),
            }),
        });

        await untilVisible('kitchen-team-forbidden');
        expect(screen.queryByTestId('kitchen-team-table')).toBeNull();
    });
});

/* ── the roles list ───────────────────────────────────────────────────────────────────────────── */

describe('the roles list', () => {
    it('separates the kitchen’s own roles from the platform templates', async () => {
        await renderStubScreen(<RolesScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listRoles: jest.fn().mockResolvedValue([template(), roleSummary()]),
                },
            },
        });

        await untilVisible('kitchen-roles-table');

        expect(screen.getByTestId(`kitchen-roles-row-${String(ROLE_ID)}-kind`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-roles-row-${String(TEMPLATE_ID)}-kind`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-roles-row-${String(ROLE_ID)}-name`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-roles-row-${String(TEMPLATE_ID)}-name`)).toBeTruthy();
    });

    it('offers Copy on a template and never Edit', async () => {
        // The one claim in this file worth the most: an edit on a template answers 404, so drawing
        // the control would be offering a door that slams.
        await renderStubScreen(<RolesScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listRoles: jest.fn().mockResolvedValue([template(), roleSummary()]),
                },
            },
        });

        await untilVisible('kitchen-roles-table');

        expect(screen.getByTestId(`kitchen-roles-row-${String(TEMPLATE_ID)}-copy`)).toBeTruthy();
        expect(screen.queryByTestId(`kitchen-roles-row-${String(ROLE_ID)}-copy`)).toBeNull();
    });

    it('sends Copy to a create seeded from the template', async () => {
        await renderStubScreen(<RolesScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: { listRoles: jest.fn().mockResolvedValue([template()]) },
            },
        });

        await untilVisible('kitchen-roles-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-roles-row-${String(TEMPLATE_ID)}-copy`));
        });

        expect(routerMock.__push).toHaveBeenCalledWith(
            `/kitchen/roles/new?from=${encodeURIComponent(String(TEMPLATE_ID))}`,
        );
    });

    it('says how many people hold each role', async () => {
        await renderStubScreen(<RolesScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    listRoles: jest
                        .fn()
                        .mockResolvedValue([
                            roleSummary(),
                            roleSummary({ id: TEMPLATE_ID, code: 'spare', holderCount: 0 }),
                        ]),
                },
            },
        });

        await untilVisible('kitchen-roles-table');

        expect(screen.getByTestId(`kitchen-roles-row-${String(ROLE_ID)}-holders`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-roles-row-${String(TEMPLATE_ID)}-holders`)).toBeTruthy();
    });
});

/* ── the role editor ──────────────────────────────────────────────────────────────────────────── */

describe('the role editor', () => {
    it('renders the pages grid at the levels the codes produce', async () => {
        setParams({ role: String(ROLE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories(),
        });

        await openRolePagesStep();
        await untilVisible('kitchen-role-editor-pages');

        // The order book is Manage, because the role holds both codes.
        expect(screen.getByTestId('kitchen-role-editor-pages-orders-level')).toBeTruthy();
        // And a sibling on a code it does not hold is drawn too, at None.
        expect(screen.getByTestId('kitchen-role-editor-pages-ingredients-level')).toBeTruthy();
    });

    it('marks a code the administrator does not hold rather than hiding it', async () => {
        // Role management is total: granting an authority you cannot exercise stays possible, and
        // this is what stops it being accidental.
        setParams({ role: String(ROLE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories(),
        });

        await untilVisible('kitchen-role-editor-tabs');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-tabs-tab-advanced'));
        });

        await untilVisible('kitchen-role-editor-advanced');

        expect(
            screen.getByTestId(
                'kitchen-role-editor-advanced-code-inventory.view_costs_organisation',
            ),
        ).toBeTruthy();
        expect(
            screen.getByTestId(
                'kitchen-role-editor-advanced-not-held-inventory.view_costs_organisation',
            ),
        ).toBeTruthy();
        expect(
            screen.queryByTestId('kitchen-role-editor-advanced-not-held-order.view_organisation'),
        ).toBeNull();
    });

    it('lists the codes no page can show, rather than hiding them', async () => {
        // `recipe.publish_organisation` is named by no family. The band is what makes "Pages will
        // not drop this" visible rather than merely true.
        setParams({ role: String(ROLE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                getRole: jest.fn().mockResolvedValue(
                    role({
                        permissions: ['order.view_organisation', 'recipe.publish_organisation'],
                    }),
                ),
            }),
        });

        await openRolePagesStep();
        await untilVisible('kitchen-role-editor-pages-unmapped');

        expect(
            screen.getByTestId('kitchen-role-editor-pages-unmapped-recipe.publish_organisation'),
        ).toBeTruthy();
    });

    it('keeps an unmapped code through a save made entirely on the Pages tab', async () => {
        // **The invariant.** A role edited on Pages keeps its publish rights.
        setParams({ role: String(ROLE_ID) });
        const updateRole = jest.fn().mockResolvedValue(role());

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                getRole: jest.fn().mockResolvedValue(
                    role({
                        permissions: ['order.view_organisation', 'recipe.publish_organisation'],
                    }),
                ),
                updateRole,
            }),
        });

        await openRolePagesStep();
        await untilVisible('kitchen-role-editor-pages');

        // Turn the order book off entirely, on the Pages tab.
        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-role-editor-pages-orders-level-option-none'),
            );
        });

        // Saved from the last step, having changed nothing past Pages.
        await openRoleAdvancedStep();
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-save'));
        });

        await waitFor(() => {
            expect(updateRole).toHaveBeenCalled();
        });

        const saved = updateRole.mock.calls[0]?.[2] as { permissions: readonly string[] };

        expect(saved.permissions).toContain('recipe.publish_organisation');
        expect(saved.permissions).not.toContain('order.view_organisation');
    });

    it('shows a template read-only, with the reason and the way out', async () => {
        setParams({ role: String(TEMPLATE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                getRole: jest
                    .fn()
                    .mockResolvedValue(
                        role({ id: TEMPLATE_ID, code: 'kitchen_manager', isSystem: true }),
                    ),
            }),
        });

        await untilVisible('kitchen-role-editor-template-notice');

        expect(screen.queryByTestId('kitchen-role-editor-save')).toBeNull();
        expect(screen.getByTestId('kitchen-role-editor-copy')).toBeTruthy();
    });

    it('names a missing Arabic name on Save rather than sending a role the server refuses', async () => {
        // `name_ar` is required by the endpoint. Save stays pressable, and the press is answered
        // on the page — the banner and the field — not by a round trip that comes back refused.
        setParams({ role: String(ROLE_ID) });
        const updateRole = jest.fn().mockResolvedValue(role());

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                getRole: jest.fn().mockResolvedValue(role({ nameAr: '' })),
                updateRole,
            }),
        });

        await openRoleAdvancedStep();
        await untilVisible('kitchen-role-editor-save');
        expect(screen.queryByTestId('kitchen-role-editor-issues-errors')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-save'));
        });

        await untilVisible('kitchen-role-editor-issues-errors');
        expect(updateRole).not.toHaveBeenCalled();
    });
});

/* ── letting somebody in ──────────────────────────────────────────────────────────────────────── */

describe('adding a member of staff', () => {
    function staffRepositories(overrides: Record<string, unknown> = {}) {
        return {
            accessAdmin: {
                listRoles: jest.fn().mockResolvedValue([roleSummary()]),
                listStaffSignInDomains: jest
                    .fn()
                    .mockResolvedValue([
                        { organisationName: 'Verdant Kitchen', domain: 'verdant.healthy360.app' },
                    ]),
                ...overrides,
            },
        };
    }

    it('offers both ways in to somebody who may do both', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories(),
        });

        await untilVisible('kitchen-staff-create-screen');

        expect(screen.getByTestId('kitchen-staff-create-mode')).toBeTruthy();
    });

    it('builds the address from the name and the kitchen\u2019s one domain', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories(),
        });

        await untilVisible('kitchen-staff-create-screen');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-mode-option-create'));
        });

        await untilVisible('kitchen-staff-create-local-part-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-staff-create-local-part-input'),
                'ahmad',
            );
        });

        // One kitchen, so no picker — the domain is stated, not chosen.
        expect(screen.queryByTestId('kitchen-staff-create-domain')).toBeNull();
        expect(screen.getByTestId('kitchen-staff-create-domain-fixed')).toHaveTextContent(
            '@verdant.healthy360.app',
        );
        expect(screen.getByTestId('kitchen-staff-create-local-part-hint')).toHaveTextContent(
            /ahmad@verdant\.healthy360\.app/,
        );
    });

    it('shows the issued password once, behind a dialog a stray tap cannot close', async () => {
        // The password exists exactly here: it is never stored readable and never read back. A
        // backdrop dismissal would lose the only copy and leave an account nobody can hand over.
        const createStaffAccount = jest.fn().mockResolvedValue({
            membershipId: MEMBERSHIP_ID,
            userId: UserId.unsafe('01935f6c-0000-7000-8000-0000000000c9'),
            email: 'ahmad@verdant.healthy360.app',
            initialPassword: 'copper-lentil-basket-seven',
        });

        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({ createStaffAccount }),
        });

        await untilVisible('kitchen-staff-create-screen');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-mode-option-create'));
        });
        await untilVisible('kitchen-staff-create-local-part-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-staff-create-local-part-input'),
                'ahmad',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-generate'));
        });

        // The names are the second of the login's three steps.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-person'));
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-staff-create-given-name-input'),
                'Ahmad',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-staff-create-family-name-input'),
                'Haddad',
            );
        });

        // The commit is the last step's Next.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-role'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-submit'));
        });

        await waitFor(() => {
            expect(createStaffAccount).toHaveBeenCalled();
        });

        const request = createStaffAccount.mock.calls[0]?.[1] as {
            localPart?: string;
            email?: string;
        };
        // The local part, not a composed address: the server owns the join, so a client that sent
        // both would be asserting a domain it only read.
        expect(request.localPart).toBe('ahmad');
        expect(request.email).toBeUndefined();

        await untilVisible('kitchen-staff-create-password-value');
        expect(screen.getByTestId('kitchen-staff-create-password-value')).toHaveTextContent(
            'copper-lentil-basket-seven',
        );
    });

    it('asks for a whole address when the kitchen has set no domain', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({
                listStaffSignInDomains: jest.fn().mockResolvedValue([]),
            }),
        });

        await untilVisible('kitchen-staff-create-screen');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-mode-option-create'));
        });

        await untilVisible('kitchen-staff-create-email-input');
        expect(screen.queryByTestId('kitchen-staff-create-local-part-input')).toBeNull();
    });

    it('lets an invitation carry one role and a login made here several', async () => {
        // The invitation endpoint takes a single `role_code`; a membership, and so a login created
        // here, holds a set. The same list, one mark or many.
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({
                listRoles: jest.fn().mockResolvedValue([roleSummary(), template()]),
            }),
        });

        await untilVisible('kitchen-staff-create-screen');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-role'));
        });
        await untilVisible('kitchen-staff-create-role-evening_counter');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-role-evening_counter'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-role-kitchen_manager'));
        });

        // Invitation: the second choice moved the mark.
        expect(
            screen.getByTestId('kitchen-staff-create-role-evening_counter').props
                .accessibilityState,
        ).toMatchObject({ checked: false });
        expect(
            screen.getByTestId('kitchen-staff-create-role-kitchen_manager').props
                .accessibilityState,
        ).toMatchObject({ checked: true });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-signIn'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-mode-option-create'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-role'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-role-evening_counter'));
        });

        // Login: both stay marked.
        expect(
            screen.getByTestId('kitchen-staff-create-role-evening_counter').props
                .accessibilityState,
        ).toMatchObject({ checked: true });
        expect(
            screen.getByTestId('kitchen-staff-create-role-kitchen_manager').props
                .accessibilityState,
        ).toMatchObject({ checked: true });
    });

    it('names what a half-filled login is missing instead of sending it', async () => {
        // The commit is always pressable; what it will not do is reach the server without the
        // names and the password the endpoint requires.
        const createStaffAccount = jest.fn();

        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({ createStaffAccount }),
        });

        await untilVisible('kitchen-staff-create-screen');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-mode-option-create'));
        });
        await untilVisible('kitchen-staff-create-local-part-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-staff-create-local-part-input'),
                'ahmad',
            );
        });
        // The commit is the last step's Next.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-tabs-tab-role'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-staff-create-submit'));
        });

        await untilVisible('kitchen-staff-create-issues-errors');
        expect(createStaffAccount).not.toHaveBeenCalled();
    });
});

/* ── one person's record ──────────────────────────────────────────────────────────────────────── */

/**
 * The screen with the most destructive controls on it, and until now the only one in this console
 * with no test at all. Suspend and Remove take somebody's access away; the band above them is the
 * only warning that nobody else will be able to give it back.
 */
describe('one member of staff', () => {
    const BRANCHES = [
        { id: BranchId.unsafe('01935f6c-0000-7000-8000-0000000000d1'), name: 'Hamra' },
        { id: BranchId.unsafe('01935f6c-0000-7000-8000-0000000000d2'), name: 'Verdun' },
    ];

    function memberRepositories(overrides: Record<string, unknown> = {}) {
        return {
            accessAdmin: {
                getTeamMember: jest.fn().mockResolvedValue({
                    membership: {
                        ...member(),
                        assignments: [{ roleId: ROLE_ID, startsAt: null, expiresAt: null }],
                        permissions: ['order.view_organisation'],
                    },
                    remainingRoleAdministrators: 2,
                    organisationBranches: BRANCHES,
                }),
                listRoles: jest.fn().mockResolvedValue([roleSummary()]),
                ...overrides,
            },
        };
    }

    beforeEach(() => {
        setParams({ membership: String(MEMBERSHIP_ID) });
    });

    it('shows who they are, what they hold and where they work', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories(),
        });

        await untilVisible('kitchen-team-member-roles');

        expect(screen.getByTestId('kitchen-team-member-role-evening_counter')).toBeTruthy();
        expect(screen.getByTestId('kitchen-team-member-status')).toBeTruthy();

        await openMemberStep('scope');
        expect(screen.getByTestId('kitchen-team-member-scope-select')).toBeTruthy();
    });

    it('says there is nothing to choose when the kitchen has one branch', async () => {
        // The vocabulary comes from the server and nowhere else, so an empty list is the honest
        // signal that this kitchen has no scope decision — not a reason to draw an empty picker.
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                getTeamMember: jest.fn().mockResolvedValue({
                    membership: { ...member(), assignments: [], permissions: [] },
                    remainingRoleAdministrators: 2,
                    organisationBranches: [],
                }),
            }),
        });

        await openMemberStep('scope');
        await untilVisible('kitchen-team-member-scope-single');
        expect(screen.queryByTestId('kitchen-team-member-scope-select')).toBeNull();
    });

    it('saves a changed role set against the version it was shown', async () => {
        const setMemberRoles = jest.fn().mockResolvedValue({
            membership: { ...member(), assignments: [], permissions: [] },
            remainingRoleAdministrators: 2,
            organisationBranches: BRANCHES,
        });

        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({ setMemberRoles }),
        });

        await untilVisible('kitchen-team-member-roles');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-role-evening_counter'));
        });
        // Save is the last step's Next.
        await openMemberStep('permissions');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-save'));
        });

        await waitFor(() => {
            expect(setMemberRoles).toHaveBeenCalled();
        });

        const request = setMemberRoles.mock.calls[0]?.[2] as {
            lockVersion: number;
            roles: readonly unknown[];
        };
        expect(request.lockVersion).toBe(0);
        expect(request.roles).toHaveLength(0);
    });

    it('writes the scope first and hands the roles write the version it got back', async () => {
        // Two endpoints, one Save. The server bumps `lock_version` on every write, so a roles call
        // reusing the version this screen loaded with would lose to the scope call that just ran.
        const setMemberScope = jest.fn().mockResolvedValue({
            membership: { ...member(), assignments: [], permissions: [], lockVersion: 7 },
            remainingRoleAdministrators: 2,
            organisationBranches: BRANCHES,
        });
        const setMemberRoles = jest.fn().mockResolvedValue({
            membership: { ...member(), assignments: [], permissions: [] },
            remainingRoleAdministrators: 2,
            organisationBranches: BRANCHES,
        });

        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({ setMemberScope, setMemberRoles }),
        });

        await openMemberStep('scope');
        await untilVisible('kitchen-team-member-scope-select');

        await act(async () => {
            fireEvent(
                screen.getByTestId('kitchen-team-member-scope-select'),
                'change',
                String(BRANCHES[1]?.id),
            );
        });
        // Save is the last step's Next.
        await openMemberStep('permissions');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-save'));
        });

        await waitFor(() => {
            expect(setMemberRoles).toHaveBeenCalled();
        });

        expect(setMemberScope.mock.calls[0]?.[2]).toMatchObject({
            lockVersion: 0,
            branchId: String(BRANCHES[1]?.id),
        });
        expect(setMemberRoles.mock.calls[0]?.[2]).toMatchObject({ lockVersion: 7 });
    });

    it('sends the whole kitchen as a null rather than as a sentinel', async () => {
        const setMemberScope = jest.fn().mockResolvedValue({
            membership: { ...member(), assignments: [], permissions: [], lockVersion: 7 },
            remainingRoleAdministrators: 2,
            organisationBranches: BRANCHES,
        });

        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                setMemberScope,
                setMemberRoles: jest.fn().mockResolvedValue({
                    membership: { ...member(), assignments: [], permissions: [] },
                    remainingRoleAdministrators: 2,
                    organisationBranches: BRANCHES,
                }),
            }),
        });

        await openMemberStep('scope');
        await untilVisible('kitchen-team-member-scope-select');

        // The fixture member is scoped to Hamra, so "the whole kitchen" is a real change.
        await act(async () => {
            fireEvent(
                screen.getByTestId('kitchen-team-member-scope-select'),
                'change',
                '__organisation__',
            );
        });
        // Save is the last step's Next.
        await openMemberStep('permissions');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-save'));
        });

        await waitFor(() => {
            expect(setMemberScope).toHaveBeenCalled();
        });

        expect(setMemberScope.mock.calls[0]?.[2]).toMatchObject({ branchId: null });
    });

    it('offers Suspend for somebody working and Reactivate for somebody suspended, never both', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories(),
        });

        await untilVisible('kitchen-team-member-suspend');
        expect(screen.queryByTestId('kitchen-team-member-reactivate')).toBeNull();
    });

    it('shows the other side of that for a suspended membership', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                getTeamMember: jest.fn().mockResolvedValue({
                    membership: {
                        ...member({ status: 'suspended' }),
                        assignments: [],
                        permissions: [],
                    },
                    remainingRoleAdministrators: 2,
                    organisationBranches: BRANCHES,
                }),
            }),
        });

        await untilVisible('kitchen-team-member-reactivate');
        expect(screen.queryByTestId('kitchen-team-member-suspend')).toBeNull();
    });

    it('asks before removing somebody, rather than removing them on the press', async () => {
        const endMember = jest.fn().mockResolvedValue({
            membership: { ...member({ status: 'ended' }), assignments: [], permissions: [] },
            remainingRoleAdministrators: 2,
            organisationBranches: BRANCHES,
        });

        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({ endMember }),
        });

        await untilVisible('kitchen-team-member-end');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-end'));
        });

        expect(endMember).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-end-confirm'));
        });

        await waitFor(() => {
            expect(endMember).toHaveBeenCalled();
        });
    });

    it('warns that nobody else can administer access, before anybody presses Remove', async () => {
        // On the *read*, not on the refusal — the server reports the count and never enforces it,
        // so a warning that only arrived after the fact would arrive after the access was gone.
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                getTeamMember: jest.fn().mockResolvedValue({
                    membership: { ...member(), assignments: [], permissions: [] },
                    remainingRoleAdministrators: 0,
                    organisationBranches: BRANCHES,
                }),
            }),
        });

        await untilVisible('kitchen-team-member-last-administrator');
    });

    it('keeps the band away when somebody else could still do it', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories(),
        });

        await untilVisible('kitchen-team-member-roles');
        expect(screen.queryByTestId('kitchen-team-member-last-administrator')).toBeNull();
    });
});

/* ── how a refusal reaches the reader ─────────────────────────────────────────────────────────── */

describe('refusals that must not vanish', () => {
    beforeEach(() => {
        setParams({ membership: String(MEMBERSHIP_ID) });
    });

    const detail = {
        membership: { ...member(), assignments: [], permissions: [] },
        remainingRoleAdministrators: 2,
        organisationBranches: [],
    };

    it('renders a self-lockout as a banner, never as a toast', async () => {
        // A toast disappears. The one refusal somebody must read before trying again is the one
        // telling them they are about to lock themselves out of the console they are standing in.
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    getTeamMember: jest.fn().mockResolvedValue(detail),
                    listRoles: jest.fn().mockResolvedValue([roleSummary()]),
                    setMemberRoles: jest
                        .fn()
                        .mockRejectedValue(new ApiError(apiFailure('access.self_lockout'))),
                },
            },
        });

        await untilVisible('kitchen-team-member-roles');

        // Save is the last step's Next.
        await openMemberStep('permissions');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-save'));
        });

        await untilVisible('kitchen-team-member-write-error');

        expect(screen.getByTestId('toast-region-polite')).toBeEmptyElement();
        expect(screen.getByTestId('toast-region-assertive')).toBeEmptyElement();
    });

    it('renders the same refusal on the role editor as a banner too', async () => {
        setParams({ role: String(ROLE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                updateRole: jest
                    .fn()
                    .mockRejectedValue(new ApiError(apiFailure('access.self_lockout'))),
            }),
        });

        await openRoleAdvancedStep();
        await untilVisible('kitchen-role-editor-save');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-save'));
        });

        await untilVisible('kitchen-role-editor-write-error');

        expect(screen.getByTestId('toast-region-polite')).toBeEmptyElement();
        expect(screen.getByTestId('toast-region-assertive')).toBeEmptyElement();
    });

    it('offers to reload when somebody else saved first', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: {
                accessAdmin: {
                    getTeamMember: jest.fn().mockResolvedValue(detail),
                    listRoles: jest.fn().mockResolvedValue([roleSummary()]),
                    setMemberRoles: jest
                        .fn()
                        .mockRejectedValue(
                            new ApiError(conflictFailure({ currentLockVersion: 3 })),
                        ),
                },
            },
        });

        await untilVisible('kitchen-team-member-roles');

        // Save is the last step's Next.
        await openMemberStep('permissions');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-team-member-save'));
        });

        await untilVisible('kitchen-team-member-conflict-reload');

        // The dialog owns the question; the banner saying the same thing with no way out of it
        // would be the same race reported twice.
        expect(screen.queryByTestId('kitchen-team-member-write-error')).toBeNull();
    });

    it('keeps a role still held on the banner, where the count is', async () => {
        // **The distinction this pair exists for.** A delete refused because six people hold the
        // role is a `resource.conflict` that is not a lost race, and `capture()` cannot tell them
        // apart — so the delete path never calls it. Offering "somebody else saved, reload?" for
        // "six people hold this" would answer a question nobody asked.
        //
        // The console hides Delete on a role anybody holds, so the only way to meet this refusal is
        // the race it was written for: the role had no holders when this screen read it, and
        // somebody assigned it before the delete landed.
        setParams({ role: String(ROLE_ID) });

        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: editorRepositories({
                getRole: jest.fn().mockResolvedValue(role({ holderCount: 0 })),
                deleteRole: jest
                    .fn()
                    .mockRejectedValue(new ApiError(conflictFailure({ membershipCount: 6 }))),
            }),
        });

        await untilVisible('kitchen-role-editor-delete');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-delete'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-role-editor-delete-confirm'));
        });

        await untilVisible('kitchen-role-editor-write-error');

        expect(screen.queryByTestId('kitchen-role-editor-conflict-dialog')).toBeNull();
    });
});
