/**
 * The API repository layer — the **only** place `src/generated/**` may be imported from
 * (plan §15, enforced by `no-restricted-imports` in the root ESLint configuration).
 */
export { DEFAULT_API_BASE_URL, generateRequestId, resolveApiBaseUrl } from './config.ts';
export type { ApiClientConfig, ClientPlatform } from './config.ts';

export {
    asErrorEnvelope,
    mapErrorEnvelope,
    readValidationFields,
    WIRE_ERROR_CODES,
} from './failures.ts';
export type { ErrorEnvelopeContext } from './failures.ts';

export {
    EMAIL_VERIFIED_AT_UNKNOWN,
    UNKNOWN_ISO_DATE_TIME,
    createBranchDirectory,
    mapActiveContext,
    mapBranch,
    mapDevice,
    mapMeResponse,
    mapMembership,
    mapMembershipRole,
    mapMembershipStatus,
    mapOrganisation,
    mapProfile,
    mapUser,
    parsePermissionsVersion,
} from './mappers.ts';
export type { BranchDirectory, WireMePayload } from './mappers.ts';

export { RESEND_VERIFICATION_COOLDOWN_SECONDS, createApiRepositories } from './repositories.ts';
export type { ApiRepositories } from './repositories.ts';

/**
 * The eight proposed contracts, as rejections. Exported so the conformance test can walk them
 * without reaching into the bundle, and so the endpoint table has one owner.
 */
export {
    API_PROTOTYPE_REPOSITORIES,
    PROTOTYPE_ENDPOINTS,
    apiBusinessRepository,
    apiCommerceRepository,
    apiFoodRepository,
    apiMarketplaceRepository,
    apiMealPlanRepository,
    apiNutritionRepository,
    apiProfessionalRepository,
    apiVirtualDietitianRepository,
} from './prototype-repositories.ts';

export { createActiveContextHolder, createTransport, readPermissionsVersion } from './transport.ts';
export type { ActiveContextHolder, Envelope, RequestSpec, Transport } from './transport.ts';
