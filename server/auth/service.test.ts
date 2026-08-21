import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountRepository } from '../accounts/account-repository.js';
import type { ActivityRepository, RecordSignInInput } from '../activity/activity-repository.js';
import type { PrepareAuthRequest } from '../../shared/contracts/auth.js';
import type { Account, SignInActivity, SignupProfile, VerifiedClaims } from '../domain/types.js';
import { AuthService } from './service.js';
import { TransactionStore } from './transaction-store.js';

const claims: VerifiedClaims = {
  email: 'sample@example.com',
  email_verified: true,
  given_name: 'Sample',
  family_name: 'User',
  name: 'Sample User',
  iss: 'https://issuer.example',
  vct: 'UserInfoCredential',
};

const requestOptions: PrepareAuthRequest = {
  protocol: 'openid4vp-v1-unsigned',
  claims: ['email', 'email_verified'],
};

test('live and sample verification enter the same profile-required account branch', async () => {
  for (const source of ['live', 'sample'] as const) {
    const service = createService(new MemoryAccountRepository());
    const request = await service.prepare('https://verifier.example', requestOptions);
    const result = source === 'live'
      ? await service.verifyLiveCredential(request.flow_id, {}, 'https://verifier.example')
      : await service.verifySampleCredential(request.flow_id, 'https://verifier.example');

    assert.equal(result.status, 'profile_required');
    assert.equal(result.source, source);
    assert.equal(result.profile.email, claims.email);
  }
});

test('sample verification supports signup and subsequent existing-account sign-in', async () => {
  const accounts = new MemoryAccountRepository();
  const activity = new MemoryActivityRepository();
  const service = createService(accounts, activity);

  const firstRequest = await service.prepare('https://verifier.example', requestOptions);
  const firstResult = await service.verifySampleCredential(firstRequest.flow_id, 'https://verifier.example');
  assert.equal(firstResult.status, 'profile_required');
  const signup = await service.completeSignup(firstResult.signup_token, {
    name: 'Edited Name',
    givenName: 'Edited',
    familyName: 'Name',
    jobTitle: 'Engineer',
    company: 'Example Co',
  });
  assert.equal(signup.status, 'signed_up');
  assert.equal(signup.source, 'sample');
  assert.equal(signup.account.name, 'Edited Name');
  assert.equal(signup.account.jobTitle, 'Engineer');
  const firstSignInAt = signup.account.lastSignInAt;

  const secondRequest = await service.prepare('https://verifier.example', requestOptions);
  const secondResult = await service.verifySampleCredential(secondRequest.flow_id, 'https://verifier.example');
  assert.equal(secondResult.status, 'signed_in');
  assert.equal(secondResult.source, 'sample');
  assert.equal(secondResult.account.id, signup.account.id);
  assert.equal(secondResult.previous_sign_in_at, firstSignInAt);
  assert.equal(secondResult.activity.length, 2);
  assert.deepEqual(secondResult.activity.map((entry) => entry.attributes.account_status), ['existing', 'new']);
});

test('a post-verification persistence failure does not consume the authentication flow', async () => {
  const accounts = new MemoryAccountRepository();
  const service = createService(accounts);
  const request = await service.prepare('https://verifier.example', requestOptions);
  accounts.failFind = true;

  await assert.rejects(
    service.verifySampleCredential(request.flow_id, 'https://verifier.example'),
    /Account datastore unavailable/,
  );

  accounts.failFind = false;
  const retried = await service.verifySampleCredential(request.flow_id, 'https://verifier.example');
  assert.equal(retried.status, 'profile_required');
});

function createService(
  accounts: AccountRepository,
  activity: ActivityRepository = new MemoryActivityRepository(),
): AuthService {
  return new AuthService({
    transactions: new TransactionStore(),
    accounts,
    activity,
    flowTtlSeconds: 300,
    signupTtlSeconds: 600,
    projectRoot: process.cwd(),
    loadSampleFixtures: async () => ({ context: {} as never, response: {} as never }),
    verifyLive: async () => ({ claims, debug: { source: 'live' } as never }),
    verifySample: async () => ({ claims, debug: { source: 'sample' } as never }),
  });
}

class MemoryAccountRepository implements AccountRepository {
  private readonly accounts: Account[] = [];
  failFind = false;

  async findByEmail(email: string): Promise<Account | undefined> {
    if (this.failFind) throw new Error('Account datastore unavailable');
    return this.accounts.find((account) => account.email === email);
  }

  async create(verified: VerifiedClaims, profile: SignupProfile): Promise<Account> {
    const timestamp = new Date().toISOString();
    const account: Account = {
      id: crypto.randomUUID(),
      email: verified.email,
      givenName: profile.givenName,
      familyName: profile.familyName,
      name: profile.name || [profile.givenName, profile.familyName].filter(Boolean).join(' ') || verified.name,
      picture: profile.picture || verified.picture,
      jobTitle: profile.jobTitle,
      company: profile.company,
      createdAt: timestamp,
      lastSignInAt: timestamp,
      credentialIssuer: verified.iss,
      verifiedClaims: { ...verified },
    };
    this.accounts.push(account);
    return account;
  }

  async markSignedIn(account: Account): Promise<Account> {
    account.lastSignInAt = new Date().toISOString();
    return account;
  }
}

class MemoryActivityRepository implements ActivityRepository {
  private readonly activity: SignInActivity[] = [];

  async recordSignIn(input: RecordSignInInput): Promise<SignInActivity> {
    const entry: SignInActivity = {
      id: crypto.randomUUID(),
      accountId: input.account.id,
      email: input.account.email,
      occurredAt: new Date().toISOString(),
      event: 'openid4vp_sign_in',
      source: input.source,
      credentialIssuer: input.claims.iss,
      attributes: { account_status: input.isNewAccount ? 'new' : 'existing' },
      traceId: input.traceId,
    };
    this.activity.unshift(entry);
    return entry;
  }

  async listByAccountId(accountId: string): Promise<SignInActivity[]> {
    return this.activity.filter((entry) => entry.accountId === accountId);
  }
}
