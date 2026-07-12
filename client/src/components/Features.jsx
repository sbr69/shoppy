import { Wallet, Robot, Receipt, Sliders } from '@phosphor-icons/react';

const features = [
  {
    icon: Wallet,
    color: 'purple',
    title: 'Custodial Wallet',
    description:
      'Sign in with Google and a Stellar wallet is created for you automatically. No extensions, no seed phrases, no friction.',
  },
  {
    icon: Robot,
    color: 'indigo',
    title: 'AI-Powered Shopping',
    description:
      'Tell the agent what you want in plain English. It searches your connected stores, finds the best match, and presents it for approval.',
  },
  {
    icon: Receipt,
    color: 'green',
    title: 'On-Chain Receipts',
    description:
      'Every purchase is recorded on the Stellar blockchain. Immutable, transparent, and verifiable — your complete shopping history.',
  },
  {
    icon: Sliders,
    color: 'orange',
    title: 'Spending Controls',
    description:
      'Set per-site spending caps and manage which stores the agent can shop from. You stay in control while the agent handles the rest.',
  },
];

export default function Features() {
  return (
    <section className="features section" id="features">
      <div className="container">
        <div className="features-header">
          <span className="badge">✦ Features</span>
          <h2>Everything You Need to<br />Shop Smarter</h2>
          <p>
            A complete AI shopping system with blockchain-backed
            security and transparency.
          </p>
        </div>

        <div className="features-grid stagger">
          {features.map((feature, i) => {
            const IconComponent = feature.icon;
            return (
              <div
                className="feature-card animate-fade-in-up"
                key={i}
                id={`feature-card-${i}`}
              >
                <div className={`feature-icon ${feature.color}`}>
                  <IconComponent size={24} weight="duotone" />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
