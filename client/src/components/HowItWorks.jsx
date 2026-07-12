const steps = [
  {
    number: 1,
    numberClass: 'step-1',
    icon: '🔑',
    title: 'Sign In & Get a Wallet',
    description:
      'One-click Google sign-in creates your Stellar wallet automatically. Fund it with testnet XLM using Friendbot.',
  },
  {
    number: 2,
    numberClass: 'step-2',
    icon: '🔗',
    title: 'Connect Your Stores',
    description:
      'Add your favourite e-commerce sites. Set spending limits per store. The agent only shops where you allow.',
  },
  {
    number: 3,
    numberClass: 'step-3',
    icon: '🛒',
    title: 'Just Tell It What to Buy',
    description:
      'Type "buy wireless earbuds under ₹2000." The agent searches, picks the best option, and buys it — on your approval.',
  },
];

export default function HowItWorks() {
  return (
    <section className="how-it-works section" id="how-it-works">
      <div className="container">
        <div className="how-it-works-header">
          <span className="badge">✦ How It Works</span>
          <h2>Three Steps to<br />Effortless Shopping</h2>
          <p>
            From sign-up to checkout in under a minute.
            No wallet extensions, no manual browsing.
          </p>
        </div>

        <div className="steps-container stagger">
          {steps.map((step, i) => (
            <div className="step-card animate-fade-in-up" key={i} id={`step-${i}`}>
              <div className={`step-number ${step.numberClass}`}>
                {step.number}
              </div>
              <div className="step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
