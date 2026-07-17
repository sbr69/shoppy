#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, BytesN, Env, Symbol};

pub use jarvis_policy_interface::TrustRule;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TrustListError { AlreadyInitialized = 1, NotInitialized = 2, InvalidLimit = 3 }

#[contracttype]
#[derive(Clone)]
enum DataKey { Initialized, Rule(Address, BytesN<32>) }

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
        env.events().publish((symbol_short!("trust_set"), owner, domain_hash), rule);
    }
    pub fn remove_rule(env: Env, owner: Address, domain_hash: BytesN<32>) {
        Self::ready(&env); owner.require_auth();
        env.storage().persistent().remove(&DataKey::Rule(owner.clone(), domain_hash.clone()));
        env.events().publish((symbol_short!("trust_rm"), owner, domain_hash), ());
    }
    pub fn get_rule(env: Env, owner: Address, domain_hash: BytesN<32>) -> Option<TrustRule> {
        Self::ready(&env); env.storage().persistent().get(&DataKey::Rule(owner, domain_hash))
    }
    fn ready(env: &Env) { if !env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(env, TrustListError::NotInitialized); } }
}
