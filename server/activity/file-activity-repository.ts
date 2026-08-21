import type { ActivityRepository, RecordSignInInput } from './activity-repository.js';
import type { SignInActivity } from '../domain/types.js';
import { readJsonArray, writeJsonArrayAtomically } from '../persistence/json-array-file.js';

export class FileActivityRepository implements ActivityRepository {
  constructor(private readonly activityFile: string) {}

  async recordSignIn(input: RecordSignInInput): Promise<SignInActivity> {
    const activity = await this.load();
    const entry: SignInActivity = {
      id: crypto.randomUUID(),
      accountId: input.account.id,
      email: input.account.email,
      occurredAt: new Date().toISOString(),
      event: 'openid4vp_sign_in',
      source: input.source,
      credentialIssuer: input.claims.iss,
      attributes: {
        account_status: input.isNewAccount ? 'new' : 'existing',
        credential_type: input.claims.vct,
        ...(input.claims.hd ? { hosted_domain: input.claims.hd } : {}),
      },
      traceId: input.traceId,
    };
    activity.push(entry);
    await this.save(activity);
    return entry;
  }

  async listByAccountId(accountId: string): Promise<SignInActivity[]> {
    const activity = await this.load();
    return activity
      .filter((entry) => entry.accountId === accountId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  private async load(): Promise<SignInActivity[]> {
    return readJsonArray<SignInActivity>(this.activityFile, 'The activity datastore');
  }

  private async save(activity: SignInActivity[]): Promise<void> {
    await writeJsonArrayAtomically(this.activityFile, activity);
  }
}
