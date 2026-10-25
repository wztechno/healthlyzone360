import type {
    OrganisationRole,
    OrganisationRoleSummary,
    PermissionDomain,
    TeamMemberSummary,
} from '@healthy360/api-client/contracts';
import { ApiError, validationFailure } from '@healthy360/api-client/contracts';
import { BranchId, MembershipId, RoleId, UserId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { permissionsAdministratorSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { RoleEditorScreen } from './screens/role-editor-screen.tsx';
import { StaffCreateScreen } from './screens/staff-create-screen.tsx';
import { TeamMemberScreen } from './screens/team-member-screen.tsx';

/*
 * The three access editors' way through, for a reader who is led rather than left to explore: the
 * commit is in the header on every step and there is no Previous / Next bar, a refused save opens
 * the step that holds the problem and says it under the field, the step's tab counts it, and
 * Cancel steps back like the browser does.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        canGoBack: jest.fn(() => true),
        dismissTo: jest.fn(),
    };
    return {
        useRouter: () => router,
        useLocalSearchParams: () => (globalThis as { __params?: unknown }).__params ?? {},
        Redirect: () => null,
        __router: router,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __router: router } = require('expo-router') as {
    __router: {
        push: jest.Mock;
        replace: jest.Mock;
        back: jest.Mock;
        canGoBack: jest.Mock;
        dismissTo: jest.Mock;
    };
};

function setParams(params: Record<string, string>) {
    (globalThis as { __params?: unknown }).__params = params;
}

beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    router.back.mockClear();
    router.dismissTo.mockClear();
    router.canGoBack.mockReset();
    router.canGoBack.mockReturnValue(true);
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

async function press(testID: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

async function type(testID: string, value: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), value);
    });
}

/** A step tab's red count. Hidden from assistive technology: the tab's own name says it. */
function pill(tabTestID: string) {
    return screen.queryByTestId(`${tabTestID}-issues`, { includeHiddenElements: true });
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const ROLE_ID = RoleId.unsafe('01935f6c-0000-7000-8000-0000000000a1');
const MEMBERSHIP_ID = MembershipId.unsafe('01935f6c-0000-7000-8000-0000000000b1');
const BRANCHES = [
    { id: BranchId.unsafe('01935f6c-0000-7000-8000-0000000000d1'), name: 'Hamra' },
    { id: BranchId.unsafe('01935f6c-0000-7000-8000-0000000000d2'), name: 'Verdun' },
];

function roleSummary(overrides: Partial<OrganisationRoleSummary> = {}): OrganisationRoleSummary {
    return {
        id: ROLE_ID,
        code: 'evening_counter',
        nameEn: 'Evening counter',
        nameAr: 'كاونتر المساء',
        descriptionEn: null,
        descriptionAr: null,
        isSystem: false,
        holderCount: 2,
        permissionCount: 2,
        lockVersion: 0,
        updatedAt: null,
        ...overrides,
    };
}

function role(): OrganisationRole {
    return {
        ...roleSummary(),
        permissions: ['order.manage_organisation', 'order.view_organisation'],
        updatedByName: 'Layla Haddad',
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
];

function member(): TeamMemberSummary {
    return {
        membershipId: MEMBERSHIP_ID,
        userId: UserId.unsafe('01935f6c-0000-7000-8000-0000000000c1'),
        givenName: 'Ahmad',
        familyName: 'Khalil',
        email: 'ahmad.khalil@verdant.test',
        status: 'active',
        joinedAt: '2026-01-15T09:30:00.000Z',
        branch: BRANCHES[0] ?? null,
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
    };
}

function roleEditorRepositories(overrides: Record<string, unknown> = {}) {
    return {
        accessAdmin: {
            getRole: jest.fn().mockResolvedValue(role()),
            listPermissions: jest.fn().mockResolvedValue(CATALOGUE),
            ...overrides,
        },
    };
}

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

/* ── the role editor ──────────────────────────────────────────────────────────────────────────── */

describe('the role editor leads the reader', () => {
    beforeEach(() => {
        setParams({ role: String(ROLE_ID) });
    });

    it('draws no step bar, and offers Save role on the first step', async () => {
        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: roleEditorRepositories(),
        });
        await untilVisible('kitchen-role-editor-details');

        expect(screen.getByTestId('kitchen-role-editor-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-role-editor-steps-nav')).toBeNull();
    });

    it('opens Details when the server refuses a name, and says so under it', async () => {
        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: roleEditorRepositories({
                updateRole: jest
                    .fn()
                    .mockRejectedValue(
                        new ApiError(validationFailure({ name_ar: ['Already used.'] })),
                    ),
            }),
        });
        await press('kitchen-role-editor-tabs-tab-advanced');
        await untilVisible('kitchen-role-editor-advanced');
        await press('kitchen-role-editor-save');

        await untilVisible('kitchen-role-editor-name-ar-error');
        expect(screen.getByTestId('kitchen-role-editor-name-ar-error')).toHaveTextContent(
            'Already used.',
        );
        expect(screen.getByTestId('kitchen-role-editor-details')).toBeTruthy();
        expect(pill('kitchen-role-editor-tabs-tab-details')).toHaveTextContent('1');
    });

    it('opens Advanced when the server refuses the permission set, and counts it there', async () => {
        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: roleEditorRepositories({
                updateRole: jest
                    .fn()
                    .mockRejectedValue(
                        new ApiError(validationFailure({ 'permissions.0': ['Unknown code.'] })),
                    ),
            }),
        });
        await untilVisible('kitchen-role-editor-details');
        await press('kitchen-role-editor-save');

        await untilVisible('kitchen-role-editor-advanced');
        expect(pill('kitchen-role-editor-tabs-tab-advanced')).toHaveTextContent('1');
        // The matrix has no field to carry it, so the message stays in the write callout.
        expect(screen.getByTestId('kitchen-role-editor-write-error')).toHaveTextContent(
            /Unknown code\./,
        );
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<RoleEditorScreen />, {
            session: permissionsAdministratorSession(),
            repositories: roleEditorRepositories(),
        });
        await press('kitchen-role-editor-back');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });
});

/* ── adding a member of staff ─────────────────────────────────────────────────────────────────── */

describe('adding a member of staff leads the reader', () => {
    it('draws no step bar, and offers the commit on the first step', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories(),
        });
        await untilVisible('kitchen-staff-create-access');

        expect(screen.getByTestId('kitchen-staff-create-submit')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-staff-create-steps-nav')).toBeNull();
    });

    it('opens the step holding the field the server refused, and says so under it', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({
                createStaffAccount: jest
                    .fn()
                    .mockRejectedValue(
                        new ApiError(validationFailure({ given_name: ['Too long.'] })),
                    ),
            }),
        });
        await press('kitchen-staff-create-mode-option-create');
        await type('kitchen-staff-create-local-part-input', 'ahmad');
        await press('kitchen-staff-create-generate');
        await press('kitchen-staff-create-tabs-tab-person');
        await type('kitchen-staff-create-given-name-input', 'Ahmad');
        await type('kitchen-staff-create-family-name-input', 'Haddad');
        // Committed from the last step: the refused field is one step back.
        await press('kitchen-staff-create-tabs-tab-role');
        await press('kitchen-staff-create-submit');

        await untilVisible('kitchen-staff-create-given-name-error');
        expect(screen.getByTestId('kitchen-staff-create-given-name-error')).toHaveTextContent(
            'Too long.',
        );
        expect(screen.getByTestId('kitchen-staff-create-person')).toBeTruthy();
        expect(pill('kitchen-staff-create-tabs-tab-person')).toHaveTextContent('1');
    });

    it('opens the step holding the first blank when the commit is pressed too soon', async () => {
        const inviteStaff = jest.fn();
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories({ inviteStaff }),
        });
        // An invitation with an address and no role, committed from the first step.
        await type('kitchen-staff-create-email-input', 'new.starter@verdant.test');
        await press('kitchen-staff-create-submit');

        await untilVisible('kitchen-staff-create-role-error');
        expect(screen.getByTestId('kitchen-staff-create-role-section')).toBeTruthy();
        expect(pill('kitchen-staff-create-tabs-tab-role')).toHaveTextContent('1');
        expect(inviteStaff).not.toHaveBeenCalled();
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<StaffCreateScreen />, {
            session: permissionsAdministratorSession(),
            repositories: staffRepositories(),
        });
        await press('kitchen-staff-create-cancel');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });
});

/* ── one member of staff ──────────────────────────────────────────────────────────────────────── */

describe('one member of staff leads the reader', () => {
    beforeEach(() => {
        setParams({ membership: String(MEMBERSHIP_ID) });
    });

    it('draws no step bar, and offers Save on the first step', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories(),
        });
        await untilVisible('kitchen-team-member-roles');

        expect(screen.getByTestId('kitchen-team-member-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-team-member-steps-nav')).toBeNull();
    });

    it('opens Where they work when the server refuses the branch, and says so under it', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                setMemberScope: jest
                    .fn()
                    .mockRejectedValue(
                        new ApiError(validationFailure({ branch_id: ['Not one of yours.'] })),
                    ),
            }),
        });
        await press('kitchen-team-member-tabs-tab-scope');
        await untilVisible('kitchen-team-member-scope-select');
        await act(async () => {
            fireEvent(
                screen.getByTestId('kitchen-team-member-scope-select'),
                'change',
                String(BRANCHES[1]?.id),
            );
        });
        // Saved from the last step: the refused field is one step back.
        await press('kitchen-team-member-tabs-tab-permissions');
        await press('kitchen-team-member-save');

        await untilVisible('kitchen-team-member-scope-select-error');
        expect(screen.getByTestId('kitchen-team-member-scope-select-error')).toHaveTextContent(
            'Not one of yours.',
        );
        expect(pill('kitchen-team-member-tabs-tab-scope')).toHaveTextContent('1');
        // Placed on its field, so the write callout has nothing left to say.
        expect(screen.queryByTestId('kitchen-team-member-write-error')).toBeNull();
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories(),
        });
        await press('kitchen-team-member-back');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('opens the team list after a removal when there is nothing to go back to', async () => {
        router.canGoBack.mockReturnValue(false);
        await renderStubScreen(<TeamMemberScreen />, {
            session: permissionsAdministratorSession(),
            repositories: memberRepositories({
                endMember: jest.fn().mockResolvedValue({
                    membership: { ...member(), status: 'ended', assignments: [], permissions: [] },
                    remainingRoleAdministrators: 2,
                    organisationBranches: BRANCHES,
                }),
            }),
        });
        await press('kitchen-team-member-end');
        await press('kitchen-team-member-end-confirm');

        await waitFor(() => {
            expect(router.replace).toHaveBeenCalledWith('/kitchen/team');
        });
    });
});
