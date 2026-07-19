let walletKitPromise;

// The wallet SDK is substantial. Keep it out of the dashboard's initial
// bundle and load it only after the user explicitly selects Stellar sign-in.
async function getWalletKit() {
  if (!walletKitPromise) {
    walletKitPromise = import('@creit.tech/stellar-wallets-kit').then(({ sep43Modules, StellarWalletsKit, WalletNetwork }) => ({
      network: WalletNetwork.TESTNET,
      kit: new StellarWalletsKit({
        network: WalletNetwork.TESTNET,
        selectedWalletId: 'freighter',
        modules: sep43Modules(),
        modalTheme: {
          bgColor: '#f7f4ee', textColor: '#2e2924', solidTextColor: '#2e2924', headerButtonColor: '#b8684f',
          dividerColor: '#ddd4c7', helpBgColor: '#efe9df', notAvailableTextColor: '#766d63',
          notAvailableBgColor: '#efe9df', notAvailableBorderColor: '#ddd4c7',
        },
      }),
    }));
  }
  return walletKitPromise;
}

async function connectWallet() {
  const { kit } = await getWalletKit();
  return new Promise((resolve, reject) => {
    void kit.openModal({
      onWalletSelected: async ({ id }) => {
        try {
          kit.setWallet(id);
          resolve(await kit.getAddress());
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Unable to connect that Stellar wallet.'));
        }
      },
      onClosed: (error) => reject(error ?? new Error('Stellar wallet connection was cancelled.')),
    }).catch((error) => reject(error instanceof Error ? error : new Error('Unable to open the Stellar wallet picker.')));
  });
}

/** Proves control of a user-owned testnet Stellar wallet using SEP-43. */
export async function signInWithStellarWallet(api, { link = false } = {}) {
  const { address } = await connectWallet();
  const basePath = link ? '/auth/stellar/link' : '/auth/stellar';
  const { data: challengeData } = await api.post(`${basePath}/challenge`, { publicKey: address });
  const { kit, network } = await getWalletKit();
  const { signedMessage } = await kit.signMessage(challengeData.challenge, {
    address,
    networkPassphrase: network,
  });
  if (!signedMessage) throw new Error('The Stellar wallet did not return a signature.');
  const { data } = await api.post(basePath, { publicKey: address, challenge: challengeData.challenge, signature: signedMessage });
  return data;
}
