#![no_std]
// Soroban entrypoints deliberately mirror the deployed ABI. Grouping these
// arguments would change the contract interface and break existing callers.
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address, BytesN, Env, Symbol};

pub use jarvis_policy_interface::TrustRule;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TrustListError { AlreadyInitialized = 1, NotInitialized = 2, InvalidLimit = 3 }

#[contracttype]
#[derive(Clone)]
enum DataKey { Initialized, Rule(Address, BytesN<32>) }

#[contractevent(topics = ["trust_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustRuleSetEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub domain_hash: BytesN<32>,
    pub rule: TrustRule,
}

#[contractevent(topics = ["trust_rm"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustRuleRemovedEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub domain_hash: BytesN<32>,
    pub removed: bool,
}

#[contract]
pub struct TrustList;

#[contractimpl]
impl TrustList {
    pub fn initialize(env: Env) {
        if env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(&env, TrustListError::AlreadyInitialized); }
        env.storage().instance().set(&DataKey::Initialized, &true);
    }
    pub fn set_rule(env: Env, owner: Address, domain_hash: BytesN<32>, merchant: Address, daily_limit: i128, per_transaction_limit: i128, category: Symbol, enabled: bool, version: u32) {
        Self::ready(&env);
        owner.require_auth();
        if daily_limit < 0 || per_transaction_limit < 0 || per_transaction_limit > daily_limit { panic_with_error!(&env, TrustListError::InvalidLimit); }
        let rule = TrustRule { merchant, daily_limit, per_transaction_limit, category, enabled, version };
        env.storage().persistent().set(&DataKey::Rule(owner.clone(), domain_hash.clone()), &rule);
        TrustRuleSetEvent { owner, domain_hash, rule }.publish(&env);
    }
    pub fn remove_rule(env: Env, owner: Address, domain_hash: BytesN<32>) {
        Self::ready(&env); owner.require_auth();
        env.storage().persistent().remove(&DataKey::Rule(owner.clone(), domain_hash.clone()));
        TrustRuleRemovedEvent { owner, domain_hash, removed: true }.publish(&env);
    }
    pub fn get_rule(env: Env, owner: Address, domain_hash: BytesN<32>) -> Option<TrustRule> {
        Self::ready(&env); env.storage().persistent().get(&DataKey::Rule(owner, domain_hash))
    }
    fn ready(env: &Env) { if !env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(env, TrustListError::NotInitialized); } }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::{TrustList, TrustListClient};
    use soroban_sdk::{symbol_short, testutils::Address as _, Address, BytesN, Env};

    #[test]
    fn owner_can_store_read_and_remove_a_merchant_rule() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TrustList, ());
        let client = TrustListClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        let merchant = Address::generate(&env);
        let domain = BytesN::from_array(&env, &[7; 32]);

        client.initialize();
        client.set_rule(&owner, &domain, &merchant, &1_000, &400, &symbol_short!("general"), &true, &1);

        let rule = client.get_rule(&owner, &domain).expect("rule should be stored");
        assert_eq!(rule.merchant, merchant);
        assert_eq!(rule.daily_limit, 1_000);
        assert_eq!(rule.per_transaction_limit, 400);
        assert!(rule.enabled);

        client.remove_rule(&owner, &domain);
        assert!(client.get_rule(&owner, &domain).is_none());
    }
}
