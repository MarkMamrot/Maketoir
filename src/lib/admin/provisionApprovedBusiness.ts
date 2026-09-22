/**
 * Shared logic for turning an approved business_applications row into a real,
 * fully provisioned business: business row + AI billing account + IMS schema
 * (if enabled) + the applicant enrolled as the business's first Admin.
 *
 * Mirrors /api/admin/onboard's one-shot provisioning, reusing the same
 * IMS provisioning + cleanup helpers so a failed provision can't leave an
 * orphaned business row or half-created IMS schema behind.
 */
import { execute } from '@/services/MySQLService';
import {
  cleanupFailedBusinessProvision,
  ImsProvisioningError,
  provisionBusinessIms,
} from '@/lib/ims/provisionBusiness';
import { enrollUserInBusiness } from '@/lib/auth/businessMemberships';

export interface ApproveBusinessApplicationInput {
  businessName: string;
  applicantUserId: number;
  hasForesight: boolean;
  hasIms: boolean;
  hasPos: boolean;
  aiPlanKey: string;
  maxLocations: number | null;
  maxUsers: number | null;
  costPerLocation: number | null;
}

export interface ApprovedBusinessResult {
  businessId: string;
  imsDbName: string | null;
}

export async function provisionApprovedBusiness(input: ApproveBusinessApplicationInput): Promise<ApprovedBusinessResult> {
  const businessId = `biz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let businessCreated = false;
  let provisionedDbName: string | null = null;
  let schemaCreated = false;

  try {
    await execute(
      `INSERT INTO businesses (business_id, name, has_foresight, has_ims, has_pos, max_locations, max_users, cost_per_location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, input.businessName,
        input.hasForesight ? 1 : 0, input.hasIms ? 1 : 0, input.hasPos ? 1 : 0,
        input.maxLocations, input.maxUsers, input.costPerLocation,
      ],
    );
    businessCreated = true;

    await execute(
      `INSERT INTO business_ai_accounts (business_id, plan_key, funding_mode, enforcement_mode, cycle_mode)
       VALUES (?, ?, 'prepaid', 'observe', 'manual')`,
      [businessId, input.aiPlanKey],
    );

    if (input.hasIms) {
      const ims = await provisionBusinessIms({ businessId, businessName: input.businessName });
      provisionedDbName = ims.imsDbName;
      schemaCreated = ims.schemaCreated;
    }

    await enrollUserInBusiness({
      userId: input.applicantUserId,
      businessId,
      tier: 'Admin',
      isDefault: true,
    });

    return { businessId, imsDbName: provisionedDbName };
  } catch (err) {
    if (err instanceof ImsProvisioningError) {
      provisionedDbName = err.imsDbName;
      schemaCreated = err.schemaCreated;
    }
    await execute('DELETE FROM business_ai_accounts WHERE business_id = ?', [businessId]).catch(() => {});
    await cleanupFailedBusinessProvision({
      businessId,
      imsDbName: provisionedDbName,
      schemaCreated,
      businessCreated,
    });
    throw err;
  }
}
