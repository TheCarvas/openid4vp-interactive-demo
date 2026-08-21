import type { AccountRepository } from './account-repository.js';
import type { Account, SignupProfile, VerifiedClaims } from '../domain/types.js';
import { readJsonArray, writeJsonArrayAtomically } from '../persistence/json-array-file.js';

export class FileAccountRepository implements AccountRepository {
  constructor(private readonly accountsFile: string) {}

  async findByEmail(email: string): Promise<Account | undefined> {
    const accounts = await this.load();
    return accounts.find((account) => account.email.toLowerCase() === email.toLowerCase());
  }

  async create(claims: VerifiedClaims, profile: SignupProfile): Promise<Account> {
    const accounts = await this.load();
    const existing = accounts.find((account) => account.email.toLowerCase() === claims.email.toLowerCase());
    if (existing) return existing;

    const now = new Date().toISOString();
    const resolvedGiven = profile.givenName || claims.given_name;
    const resolvedFamily = profile.familyName || claims.family_name;
    const displayName = profile.name
      || [resolvedGiven, resolvedFamily].filter(Boolean).join(' ')
      || claims.name;
    const account: Account = {
      id: crypto.randomUUID(),
      email: claims.email,
      givenName: resolvedGiven,
      familyName: resolvedFamily,
      name: displayName,
      picture: profile.picture || claims.picture,
      jobTitle: profile.jobTitle,
      company: profile.company,
      createdAt: now,
      lastSignInAt: now,
      credentialIssuer: claims.iss,
      verifiedClaims: { ...claims },
    };

    accounts.push(account);
    await this.save(accounts);
    return account;
  }

  async markSignedIn(account: Account): Promise<Account> {
    const accounts = await this.load();
    const index = accounts.findIndex((candidate) => candidate.id === account.id);
    if (index === -1) return account;
    accounts[index] = { ...accounts[index], lastSignInAt: new Date().toISOString() };
    await this.save(accounts);
    return accounts[index];
  }

  private async load(): Promise<Account[]> {
    return readJsonArray<Account>(this.accountsFile, 'The account datastore');
  }

  private async save(accounts: Account[]): Promise<void> {
    await writeJsonArrayAtomically(this.accountsFile, accounts);
  }
}
