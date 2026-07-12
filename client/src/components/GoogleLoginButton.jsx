import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

export default function GoogleLoginButton({ onSuccess }) {
  const { loginWithGoogle } = useAuth();

  const login = useGoogleLogin({
    flow: 'implicit',
    onSuccess: async (tokenResponse) => {
      try {
        // Get the ID token by calling Google's userinfo endpoint first,
        // then we use the access_token to get an ID token via tokeninfo
        // Actually, for implicit flow we get access_token. We need to use
        // 'authorization_code' flow or use the credential from One Tap.
        // Let's use the Google Sign-In button (One Tap) instead.
      } catch (err) {
        console.error('Login failed:', err);
      }
    },
    onError: (error) => {
      console.error('Google login error:', error);
    },
  });

  // We'll use this as a fallback — the main login is via GoogleLogin component
  return null;
}
