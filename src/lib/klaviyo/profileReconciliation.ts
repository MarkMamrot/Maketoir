import { imsQuery } from '@/services/IMSMySQLService';
import type { KlaviyoProfileRecord, KlaviyoService } from '@/services/KlaviyoService';
import { buildKlaviyoContactIdentity, type KlaviyoContactType } from './contracts';
import {
  getKlaviyoProfileMapping,
  recordKlaviyoProfileConflict,
  recordLinkedKlaviyoProfileMapping,
  type KlaviyoProfileMapping,
} from './profileMappings';

interface ContactRow {
  id: number;
  type: KlaviyoContactType;
  email: string | null;
  phone: string | null;
  mobile: string | null;
}

export class KlaviyoProfileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KlaviyoProfileConflictError';
  }
}

export interface KlaviyoProfileReconciliationDependencies {
  loadContact: (businessId: string, contactId: number) => Promise<ContactRow | null>;
  loadMapping: (businessId: string, contactId: number) => Promise<KlaviyoProfileMapping | null>;
  recordLinked: typeof recordLinkedKlaviyoProfileMapping;
  recordConflict: typeof recordKlaviyoProfileConflict;
}

const defaultDependencies: KlaviyoProfileReconciliationDependencies = {
  async loadContact(businessId, contactId) {
    const rows = await imsQuery<ContactRow>(
      `SELECT id, type, email, phone, mobile
         FROM ims_contacts
        WHERE business_id = ? AND id = ? AND is_active = 1
        LIMIT 1`,
      [businessId, contactId],
    );
    return rows[0] ?? null;
  },
  loadMapping: getKlaviyoProfileMapping,
  recordLinked: recordLinkedKlaviyoProfileMapping,
  recordConflict: recordKlaviyoProfileConflict,
};

function distinctProfiles(groups: KlaviyoProfileRecord[][]): KlaviyoProfileRecord[] {
  return [...new Map(groups.flat().map(profile => [profile.id, profile])).values()];
}

export async function reconcileKlaviyoProfile(
  input: { businessId: string; contactId: number; client: Pick<KlaviyoService, 'findProfilesByIdentifier' | 'createProfile' | 'updateProfile'> },
  dependencies: KlaviyoProfileReconciliationDependencies = defaultDependencies,
): Promise<KlaviyoProfileRecord> {
  const contact = await dependencies.loadContact(input.businessId, input.contactId);
  if (!contact) throw new Error('The IMS contact for this Klaviyo event no longer exists or is inactive.');
  const identity = buildKlaviyoContactIdentity({ businessId: input.businessId, contactId: contact.id, contactType: contact.type,
    email: contact.email, phone: contact.phone, mobile: contact.mobile });
  if (!identity.eligible || !identity.profile?.externalId) {
    throw new Error('The IMS contact is not eligible for Klaviyo profile synchronization.');
  }

  const mapping = await dependencies.loadMapping(input.businessId, input.contactId);
  if (mapping?.status === 'conflict') {
    throw new KlaviyoProfileConflictError(mapping.safeError || 'The Klaviyo profile mapping is in conflict.');
  }
  if (mapping?.status === 'linked' && mapping.profileId) {
    return input.client.updateProfile(mapping.profileId, identity.profile);
  }

  const candidates = distinctProfiles(await Promise.all([
    input.client.findProfilesByIdentifier('external_id', identity.profile.externalId),
    ...(identity.profile.email ? [input.client.findProfilesByIdentifier('email', identity.profile.email)] : []),
    ...(identity.profile.phoneNumber ? [input.client.findProfilesByIdentifier('phone_number', identity.profile.phoneNumber)] : []),
  ]));
  if (candidates.length > 1) {
    const safeError = 'Contact identifiers resolve to multiple Klaviyo profiles; manual reconciliation is required.';
    await dependencies.recordConflict({ businessId: input.businessId, contactId: input.contactId,
      externalId: identity.profile.externalId, safeError });
    throw new KlaviyoProfileConflictError(safeError);
  }

  const profile = candidates[0]
    ? await input.client.updateProfile(candidates[0].id, identity.profile)
    : await input.client.createProfile(identity.profile);
  const saved = await dependencies.recordLinked({ businessId: input.businessId, contactId: input.contactId,
    profileId: profile.id, externalId: identity.profile.externalId });
  if (saved.status !== 'linked' || saved.profileId !== profile.id) {
    throw new KlaviyoProfileConflictError(saved.safeError || 'The Klaviyo profile mapping conflicts with an existing contact.');
  }
  return profile;
}