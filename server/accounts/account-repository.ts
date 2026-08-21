import type { Account, SignupProfile, VerifiedClaims } from '../domain/types.js';

export interface AccountRepository {
  findByEmail(email: string): Promise<Account | undefined>;
  create(claims: VerifiedClaims, profile: SignupProfile): Promise<Account>;
  markSignedIn(account: Account): Promise<Account>;
}
