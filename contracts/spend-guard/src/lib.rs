#![no_std]

use jarvis_policy_interface::TrustListClient;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SpendGuardError { AlreadyInitialized = 1, NotInitialized = 2, Unauthorized = 3, InvalidAmount = 4, InsufficientEscrow = 5, MerchantNotTrusted = 6, PerTransactionLimit = 7, DailyLimit = 8, DuplicateIntent = 9 }

#[contracttype]
#[derive(Clone)]
enum DataKey { Initialized, Token, TrustList, Agent(Address), Escrow(Address), Spent(Address, BytesN<32>, u64), Used(Address, BytesN<32>) }

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
        env.events().publish((symbol_short!("agent_set"), owner), agent);
    }
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        Self::ready(&env); owner.require_auth(); Self::positive(&env, amount);
        token::Client::new(&env, &Self::token(&env)).transfer(&owner, &env.current_contract_address(), &amount);
        let balance = Self::balance(&env, &owner) + amount;
        env.storage().persistent().set(&DataKey::Escrow(owner.clone()), &balance);
        env.events().publish((symbol_short!("deposit"), owner), amount);
    }
    pub fn withdraw(env: Env, owner: Address, recipient: Address, amount: i128) {
        Self::ready(&env); owner.require_auth(); Self::positive(&env, amount);
        let balance = Self::balance(&env, &owner);
        if balance < amount { panic_with_error!(&env, SpendGuardError::InsufficientEscrow); }
        token::Client::new(&env, &Self::token(&env)).transfer(&env.current_contract_address(), &recipient, &amount);
        env.storage().persistent().set(&DataKey::Escrow(owner.clone()), &(balance - amount));
    }
    pub fn spend(env: Env, owner: Address, agent: Address, domain_hash: BytesN<32>, merchant: Address, amount: i128, intent_hash: BytesN<32>, receipt_hash: BytesN<32>) {
        Self::ready(&env); agent.require_auth(); Self::positive(&env, amount);
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
        env.events().publish((symbol_short!("purchased"), owner, intent_hash), (domain_hash, merchant, amount, receipt_hash));
    }
    pub fn escrow_balance(env: Env, owner: Address) -> i128 { Self::balance(&env, &owner) }
    fn ready(env: &Env) { if !env.storage().instance().has(&DataKey::Initialized) { panic_with_error!(env, SpendGuardError::NotInitialized); } }
    fn positive(env: &Env, amount: i128) { if amount <= 0 { panic_with_error!(env, SpendGuardError::InvalidAmount); } }
    fn token(env: &Env) -> Address { env.storage().instance().get(&DataKey::Token).unwrap_or_else(|| panic_with_error!(env, SpendGuardError::NotInitialized)) }
    fn trust_list(env: &Env) -> Address { env.storage().instance().get(&DataKey::TrustList).unwrap_or_else(|| panic_with_error!(env, SpendGuardError::NotInitialized)) }
    fn balance(env: &Env, owner: &Address) -> i128 { env.storage().persistent().get(&DataKey::Escrow(owner.clone())).unwrap_or(0) }
}
