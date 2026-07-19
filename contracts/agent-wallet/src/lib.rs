#![no_std]
// The public methods are the deployed contract ABI. Keep their shape stable
// for the backend and existing smart wallets.
#![allow(clippy::too_many_arguments)]

use jarvis_policy_interface::TrustListClient;
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token, Address, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AgentWalletError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    MerchantNotTrusted = 6,
    PerTransactionLimit = 7,
    DailyLimit = 8,
    DuplicateIntent = 9,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Initialized,
    Owner,
    Agent,
    Token,
    TrustList,
    Spent(BytesN<32>, u64),
    Used(BytesN<32>),
}

#[contractevent(topics = ["funded"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletFundedEvent {
    #[topic]
    pub owner: Address,
    pub amount: i128,
}

#[contractevent(topics = ["purchased"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletPurchaseEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub intent_hash: BytesN<32>,
    pub domain_hash: BytesN<32>,
    pub merchant: Address,
    pub amount: i128,
    pub receipt_hash: BytesN<32>,
}

#[contractevent(topics = ["withdrawn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletWithdrawnEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(topics = ["agent_set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletAgentSetEvent {
    #[topic]
    pub owner: Address,
    pub agent: Address,
}

/// A per-user programmable wallet. The contract itself holds the spendable
/// XLM; the backend agent can only move that balance by calling `spend`, which
/// enforces the TrustList policy before performing the transfer.
#[contract]
pub struct AgentWallet;

#[contractimpl]
impl AgentWallet {
    pub fn __constructor(env: Env, owner: Address, agent: Address, token: Address, trust_list: Address) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(&env, AgentWalletError::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Agent, &agent);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::TrustList, &trust_list);
        WalletAgentSetEvent { owner, agent }.publish(&env);
    }

    /// Move funds from the custodial funding account into this smart wallet.
    /// This is performed when the user funds the wallet, never per purchase.
    pub fn fund(env: Env, owner: Address, amount: i128) {
        Self::ready(&env);
        Self::require_owner(&env, &owner);
        Self::positive(&env, amount);
        token::Client::new(&env, &Self::token(&env)).transfer(&owner, env.current_contract_address(), &amount);
        WalletFundedEvent { owner, amount }.publish(&env);
    }

    /// Transfer directly from the smart-wallet balance to the merchant only
    /// after every policy check succeeds. Both the constrained agent and the
    /// separate custodial owner must authorize this exact invocation, so an
    /// agent-key compromise alone can never spend wallet funds. All checks and
    /// the transfer are one atomic Soroban invocation.
    pub fn spend(env: Env, agent: Address, domain_hash: BytesN<32>, merchant: Address, amount: i128, intent_hash: BytesN<32>, receipt_hash: BytesN<32>) {
        Self::ready(&env);
        let owner = Self::owner(&env);
        owner.require_auth();
        agent.require_auth();
        if agent != Self::agent(&env) {
            panic_with_error!(&env, AgentWalletError::Unauthorized);
        }
        Self::positive(&env, amount);
        if env.storage().persistent().has(&DataKey::Used(intent_hash.clone())) {
            panic_with_error!(&env, AgentWalletError::DuplicateIntent);
        }

        let rule = TrustListClient::new(&env, &Self::trust_list(&env))
            .get_rule(&owner, &domain_hash)
            .unwrap_or_else(|| panic_with_error!(&env, AgentWalletError::MerchantNotTrusted));
        if !rule.enabled || rule.merchant != merchant {
            panic_with_error!(&env, AgentWalletError::MerchantNotTrusted);
        }
        if amount > rule.per_transaction_limit {
            panic_with_error!(&env, AgentWalletError::PerTransactionLimit);
        }
        let day = env.ledger().timestamp() / 86_400;
        let spent_key = DataKey::Spent(domain_hash.clone(), day);
        let spent: i128 = env.storage().persistent().get(&spent_key).unwrap_or(0);
        if spent + amount > rule.daily_limit {
            panic_with_error!(&env, AgentWalletError::DailyLimit);
        }
        let wallet = env.current_contract_address();
        let token_client = token::Client::new(&env, &Self::token(&env));
        if token_client.balance(&wallet) < amount {
            panic_with_error!(&env, AgentWalletError::InsufficientBalance);
        }

        token_client.transfer(&wallet, &merchant, &amount);
        env.storage().persistent().set(&spent_key, &(spent + amount));
        env.storage().persistent().set(&DataKey::Used(intent_hash.clone()), &true);
        WalletPurchaseEvent { owner, intent_hash, domain_hash, merchant, amount, receipt_hash }.publish(&env);
    }

    /// The owner can withdraw unused funds from the wallet. This is not used
    /// by the purchase flow, but guarantees recoverability of customer funds.
    pub fn withdraw(env: Env, owner: Address, recipient: Address, amount: i128) {
        Self::ready(&env);
        Self::require_owner(&env, &owner);
        Self::positive(&env, amount);
        let wallet = env.current_contract_address();
        let token_client = token::Client::new(&env, &Self::token(&env));
        if token_client.balance(&wallet) < amount {
            panic_with_error!(&env, AgentWalletError::InsufficientBalance);
        }
        token_client.transfer(&wallet, &recipient, &amount);
        WalletWithdrawnEvent { owner, recipient, amount }.publish(&env);
    }

    pub fn set_agent(env: Env, owner: Address, agent: Address) {
        Self::ready(&env);
        Self::require_owner(&env, &owner);
        env.storage().persistent().set(&DataKey::Agent, &agent);
        WalletAgentSetEvent { owner, agent }.publish(&env);
    }

    pub fn balance(env: Env) -> i128 {
        Self::ready(&env);
        token::Client::new(&env, &Self::token(&env)).balance(&env.current_contract_address())
    }

    pub fn owner_address(env: Env) -> Address {
        Self::ready(&env);
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn agent_address(env: Env) -> Address {
        Self::ready(&env);
        env.storage().instance().get(&DataKey::Agent).unwrap()
    }

    fn ready(env: &Env) {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(env, AgentWalletError::NotInitialized);
        }
    }

    fn owner(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    fn agent(env: &Env) -> Address {
        env.storage().persistent().get(&DataKey::Agent).unwrap_or_else(|| env.storage().instance().get(&DataKey::Agent).unwrap())
    }

    fn token(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    fn trust_list(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::TrustList).unwrap()
    }

    fn require_owner(env: &Env, owner: &Address) {
        if owner != &Self::owner(env) {
            panic_with_error!(env, AgentWalletError::Unauthorized);
        }
        owner.require_auth();
    }

    fn positive(env: &Env, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, AgentWalletError::InvalidAmount);
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test {
    use super::{AgentWallet, AgentWalletClient};
    use jarvis_trust_list::{TrustList, TrustListClient};
    use soroban_sdk::{symbol_short, testutils::Address as _, token, Address, BytesN, Env};

    #[test]
    fn guarded_spend_moves_funds_only_to_the_trusted_merchant() {
        let env = Env::default();
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let agent = Address::generate(&env);
        let merchant = Address::generate(&env);
        let domain = BytesN::from_array(&env, &[3; 32]);
        let intent = BytesN::from_array(&env, &[4; 32]);
        let receipt = BytesN::from_array(&env, &[5; 32]);

        let trust_list_id = env.register(TrustList, ());
        let trust_list = TrustListClient::new(&env, &trust_list_id);
        trust_list.initialize();
        trust_list.set_rule(&owner, &domain, &merchant, &1_000, &500, &symbol_short!("general"), &true, &1);

        let token_id = env.register_stellar_asset_contract_v2(owner.clone()).address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&owner, &1_000);

        let wallet_id = env.register(AgentWallet, (&owner, &agent, &token_id, &trust_list_id));
        let wallet = AgentWalletClient::new(&env, &wallet_id);
        wallet.fund(&owner, &1_000);
        wallet.spend(&agent, &domain, &merchant, &250, &intent, &receipt);

        let token_client = token::TokenClient::new(&env, &token_id);
        assert_eq!(token_client.balance(&merchant), 250);
        assert_eq!(wallet.balance(), 750);
    }
}
