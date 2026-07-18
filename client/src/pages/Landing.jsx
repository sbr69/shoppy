import { useState } from 'react';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import Features from '../components/Features';
import HowItWorks from '../components/HowItWorks';
import CTASection from '../components/CTASection';
import Footer from '../components/Footer';
import LoginModal from '../components/common/LoginModal';

export default function Landing() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <>
      <Navbar onSignIn={() => setShowLogin(true)} />
      <main>
        <Hero onSignIn={() => setShowLogin(true)} />
        <Features />
        <HowItWorks />
        <CTASection onSignIn={() => setShowLogin(true)} />
      </main>
      <Footer />

      <LoginModal 
        isOpen={showLogin} 
        onClose={() => setShowLogin(false)} 
      />
    </>
  );
}
