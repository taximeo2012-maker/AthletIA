import { useState } from 'react';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Activity, Zap } from 'lucide-react';
import { motion } from 'motion/react';

export function Login() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError('');
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) {
         await setDoc(userRef, {
           createdAt: serverTimestamp(),
           updatedAt: serverTimestamp()
         });
      }
      
      navigate('/');
    } catch (err) {
      console.error(err);
      setError('Erreur lors de la connexion. Vérifie les logs.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1115] flex flex-col items-center justify-center p-6 text-white relative overflow-hidden selection:bg-orange-500/30">
      
      {/* Background decorations */}
      <div className="absolute top-1/4 -left-32 w-64 h-64 bg-orange-500/10 rounded-full blur-[100px]"></div>
      <div className="absolute bottom-1/4 -right-32 w-64 h-64 bg-red-500/10 rounded-full blur-[100px]"></div>

      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="w-24 h-24 bg-gradient-to-br from-[#fc4c02] to-red-600 rounded-[32px] flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(252,76,2,0.4)] ring-1 ring-white/10 relative z-10"
      >
        <Zap size={48} className="text-white" />
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
        className="text-center mb-12 relative z-10"
      >
        <h1 className="text-5xl font-black italic uppercase tracking-tighter mb-4 text-white">Athlet<span className="text-[#fc4c02]">IA</span></h1>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-sm leading-relaxed max-w-xs mx-auto">Ton intelligence sportive personnelle.</p>
      </motion.div>

      {error && <p className="text-red-400 mb-4 text-sm relative z-10 font-bold">{error}</p>}

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        className="w-full max-w-sm relative z-10"
      >
        <motion.button 
          whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.1)" }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGoogleLogin}
          disabled={isLoading}
          className="w-full bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-sm py-5 rounded-2xl flex items-center justify-center space-x-3 shadow-xl backdrop-blur-md transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <span className="animate-pulse">Connexion...</span>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Continuer avec Google</span>
            </>
          )}
        </motion.button>
        <p className="text-slate-500 text-xs mt-8 opacity-70 text-center uppercase tracking-widest font-bold">
          Connecte ton compte Google<br/>puis autorise Strava
        </p>
      </motion.div>
    </div>
  );
}
