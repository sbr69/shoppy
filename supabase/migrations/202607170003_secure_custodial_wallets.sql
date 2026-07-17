-- Switch the testnet implementation to the explicitly requested secure
-- custodial model. Browser passkey vault records are no longer active.
alter table public.wallets drop constraint if exists wallets_custody_mode_check;
alter table public.wallets add constraint wallets_custody_mode_check check (custody_mode in ('server_custody', 'passkey_vault', 'legacy_server_custody'));

-- Existing passkey test wallets are reset because their owner secret never
-- existed on the server. New server-generated test wallets are provisioned at
-- the next Google login.
update public.wallets
set public_key = null, encrypted_secret = null, iv = null, auth_tag = null,
    vault_ciphertext = null, vault_iv = null, vault_salt = null,
    passkey_credential_id = null, custody_mode = 'server_custody',
    status = 'setup_required', provisioned_at = null
where custody_mode = 'passkey_vault';

delete from public.passkey_challenges;
delete from public.passkey_credentials;
