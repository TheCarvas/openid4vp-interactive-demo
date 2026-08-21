import type { Account, SignInActivity, VerifiedClaims } from '../domain/types.js';
import type { CredentialSource } from '../../shared/contracts/auth.js';

export type RecordSignInInput = {
  account: Account;
  claims: VerifiedClaims;
  source: CredentialSource;
  isNewAccount: boolean;
  traceId?: string;
};

export interface ActivityRepository {
  recordSignIn(input: RecordSignInInput): Promise<SignInActivity>;
  listByAccountId(accountId: string): Promise<SignInActivity[]>;
}
