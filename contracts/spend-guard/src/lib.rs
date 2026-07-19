#![no_std]
// Soroban entrypoints deliberately mirror the deployed ABI. Grouping these
// arguments would change the contract interface and break existing callers.
#![allow(clippy::too_many_arguments)]

use jarvis_policy_interface::TrustListClient;
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token, Address, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SpendGuardError { AlreadyInitialized = 1, NotInitialized = 2, Unauthorized = 3, InvalidAmount = 4, InsufficientEscrow = 5, MerchantNotTrusted = 6, PerTransactionLimit = 7, DailyLimit = 8, DuplicateIntent = 9 }

#[contracttype]
#[derive(Clone)]
enum DataKey { Initialized, Token, TrustList, Agent(Address), Escrow(Address), Spent(Address, BytesN<32>, u64), Used(Address, BytesN<32>) }

#[contractevent(topics = ["agent_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentSetEvent {
    #[topic]
    pub owner: Address,
    pub agent: Address,
}

#[contractevent(topics = ["deposit"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    #[topic]
    pub owner: Address,
    pub amount: i128,
}

#[contractevent(topics = ["purchased"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PurchaseAttestedEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub intent_hash: BytesN<32>,
    pub domain_hash: BytesN<32>,
    pub merchant: Address,
    pub amount: i128,
    pub receipt_hash: BytesN<32>,
}

#[contract]
pub struct SpendGuard;

#[contractimpl]
impl SpendGuard {
    pub fn initialize(env: Env, token: Address, trust_list: Address) {
        if env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(&env, SpendGuardError::AlreadyInitialized); }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::TrustList, &trust_list);
    }
    pub fn set_agent(env: Env, owner: Address, agent: Address) {
        Self::ready(&env); owner.require_auth();
        env.storage().persistent().set(&DataKey::Agent(owner.clone()), &agent);
        AgentSetEvent { owner, agent }.publish(&env);
    }
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        Self::ready(&env); owner.require_auth(); Self::positive(&env, amount);
        token::Client::new(&env, &Self::token(&env)).transfer(&owner, env.current_contract_address(), &amount);
        let balance = Self::balance(&env, &owner) + amount;
        env.storage().persistent().set(&DataKey::Escrow(owner.clone()), &balance);
        DepositEvent { owner, amount }.publish(&env);
    }
    pub fn withdraw(env: Env, owner: Address, recipient: Address, amount: i128) {
        Self::ready(&env); owner.require_auth(); Self::positive(&env, amount);
        let balance = Self::balance(&env, &owner);
        if balance < amount { panic_with_error!(&env, SpendGuardError::InsufficientEscrow); }
        token::Client::new(&env, &Self::token(&env)).transfer(&env.current_contract_address(), &recipient, &amount);
        env.storage().persistent().set(&DataKey::Escrow(owner.clone()), &(balance - amount));
    }
    pub fn spend(env: Env, owner: Address, agent: Address, domain_hash: BytesN<32>, merchant: Address, amount: i128, intent_hash: BytesN<32>, receipt_hash: BytesN<32>) {
        // A constrained agent alone must never be able to spend. Every exact
        // purchase needs a fresh owner authorization entry as well as the
        // backend agent signer that is bound to this owner below.
        Self::ready(&env); owner.require_auth(); agent.require_auth(); Self::positive(&env, amount);
        let configured: Address = env.storage().persistent().get(&DataKey::Agent(owner.clone())).unwrap_or_else(|| panic_with_error!(&env, SpendGuardError::Unauthorized));
        if configured != agent { panic_with_error!(&env, SpendGuardError::Unauthorized); }
        if env.storage().persistent().has(&DataKey::Used(owner.clone(), intent_hash.clone())) { panic_with_error!(&env, SpendGuardError::DuplicateIntent); }
        let rule = TrustListClient::new(&env, &Self::trust_list(&env)).get_rule(&owner, &domain_hash).unwrap_or_else(|| panic_with_error!(&env, SpendGuardError::MerchantNotTrusted));
        if !rule.enabled || rule.merchant != merchant { panic_with_error!(&env, SpendGuardError::MerchantNotTrusted); }
        if amount > rule.per_transaction_limit { panic_with_error!(&env, SpendGuardError::PerTransactionLimit); }
        let day = env.ledger().timestamp() / 86_400;
        let key = DataKey::Spent(owner.clone(), domain_hash.clone(), day);
        let spent: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if spent + amount > rule.daily_limit { panic_with_error!(&env, SpendGuardError::DailyLimit); }
        let balance = Self::balance(&env, &owner);
        if balance < amount { panic_with_error!(&env, SpendGuardError::InsufficientEscrow); }
        token::Client::new(&env, &Self::token(&env)).transfer(&env.current_contract_address(), &merchant, &amount);
        env.storage().persistent().set(&DataKey::Escrow(owner.clone()), &(balance - amount));
        env.storage().persistent().set(&key, &(spent + amount));
        env.storage().persistent().set(&DataKey::Used(owner.clone(), intent_hash.clone()), &true);
        PurchaseAttestedEvent { owner, intent_hash, domain_hash, merchant, amount, receipt_hash }.publish(&env);
    }
    pub fn escrow_balance(env: Env, owner: Address) -> i128 { Self::balance(&env, &owner) }
    fn ready(env: &Env) { if !env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(env, SpendGuardError::NotInitialized); } }
    fn positive(env: &Env, amount: i128) { if amount <= 0 { panic_with_error!(env, SpendGuardError::InvalidAmount); } }
    fn token(env: &Env) -> Address { env.storage().instance().get(&DataKey::Token).unwrap_or_else(|| panic_with_error!(env, SpendGuardError::NotInitialized)) }
    fn trust_list(env: &Env) -> Address { env.storage().instance().get(&DataKey::TrustList).unwrap_or_else(|| panic_with_error!(env, SpendGuardError::NotInitialized)) }
    fn balance(env: &Env, owner: &Address) -> i128 { env.storage().persistent().get(&DataKey::Escrow(owner.clone())).unwrap_or(0) }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::{SpendGuard, SpendGuardClient};
    use jarvis_trust_list::{TrustList, TrustListClient};
    use soroban_sdk::{symbol_short, testutils::Address as _, token, Address, BytesN, Env};

    #[test]
    fn trusted_guarded_spend_releases_only_the_approved_escrow_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let agent = Address::generate(&env);
        let merchant = Address::generate(&env);
        let domain = BytesN::from_array(&env, &[8; 32]);
        let intent = BytesN::from_array(&env, &[9; 32]);
        let receipt = BytesN::from_array(&env, &[10; 32]);

        let trust_list_id = env.register(TrustList, ());
        let trust_list = TrustListClient::new(&env, &trust_list_id);
        trust_list.initialize();
        trust_list.set_rule(&owner, &domain, &merchant, &1_000, &500, &symbol_short!("general"), &true, &1);

        let token_id = env.register_stellar_asset_contract_v2(owner.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&owner, &1_000);

        let guard_id = env.register(SpendGuard, ());
        let guard = SpendGuardClient::new(&env, &guard_id);
        guard.initialize(&token_id, &trust_list_id);
        guard.set_agent(&owner, &agent);
        guard.deposit(&owner, &1_000);
        guard.spend(&owner, &agent, &domain, &merchant, &250, &intent, &receipt);

        let token_client = token::TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&merchant), 250);
        assert_eq!(guard.escrow_balance(&owner), 750);
    }
}
