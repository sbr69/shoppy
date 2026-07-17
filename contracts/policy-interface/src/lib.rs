#![no_std]

use soroban_sdk::{contractclient, contracttype, Address, BytesN, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustRule {
    pub merchant: Address,
    pub daily_limit: i128,
    pub per_transaction_limit: i128,
    pub category: Symbol,
    pub enabled: bool,
    pub version: u32,
}

#[contractclient(name = "TrustListClient")]
pub trait TrustListInterface {
    fn get_rule(env: Env, owner: Address, domain_hash: BytesN<32>) -> Option<TrustRule>;
}
