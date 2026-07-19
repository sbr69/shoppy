import { useState } from 'react';
import { Wallet } from '@phosphor-icons/react';
import api from '../../services/api';
import { signInWithStellarWallet } from '../../services/stellarWalletAuth';

export default function StellarWalletLoginButton({ onSuccess, onError, link = false, className = '' }) {
  const [loading, setLoading] = useState(false);
  const label = loading ? 'Waiting for wallet…' : link ? 'Link Stellar wallet' : 'Continue with Stellar wallet';

  return (
    <button
      type="button"
      className={`stellar-wallet-login ${className}`}
      disabled={loading}
      onClick={async () => {
        try {
          setLoading(true);
          const data = await signInWithStellarWallet(api, { link });
          await onSuccess?.(data);
        } catch (error) {
          if (!/cancelled/i.test(error?.message || '')) onError?.(error.response?.data?.error || error.message || 'Unable to authenticate your Stellar wallet.');
        } finally {
          setLoading(false);
        }
      }}
    >
      <Wallet size={18} weight="duotone" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
