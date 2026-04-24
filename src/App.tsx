import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Home, MessageCircle, Utensils, Calendar, ChefHat } from 'lucide-react';
import { motion } from 'motion/react';
import { Dashboard } from './pages/Dashboard';
import { Journal } from './pages/Journal';
import { Coach } from './pages/Coach';
import { TrainingPrograms } from './pages/TrainingPrograms';
import { Login } from './pages/Login';
import { Cuisine } from './pages/Cuisine';

function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Bilan', icon: Home },
    { path: '/journal', label: 'Journal', icon: Utensils },
    { path: '/cuisine', label: 'Cuisine', icon: ChefHat },
    { path: '/prog', label: 'Plan', icon: Calendar },
    { path: '/coach', label: 'Coach', icon: MessageCircle },
  ];

  return (
    <div className="bg-[#1A1C23]/90 backdrop-blur-xl border-t border-white/5 pb-safe z-50 shrink-0">
      <div className="flex justify-around items-center h-20 px-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center w-full h-full"
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-indicator"
                  className="absolute top-0 w-12 h-1 bg-gradient-to-r from-orange-500 to-red-500 rounded-b-full shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              <motion.div 
                whileTap={{ scale: 0.9 }}
                className={`flex flex-col items-center space-y-1.5 mt-2 ${isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <item.icon size={22} className={isActive ? "drop-shadow-[0_2px_10px_rgba(249,115,22,0.4)]" : ""} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
              </motion.div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F1115]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="h-12 w-12 border-4 border-[#0F1115] border-t-orange-500 rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#0F1115] text-slate-200 selection:bg-orange-500/30 selection:text-orange-200">
      <div className="flex-1 overflow-hidden relative flex flex-col pt-safe">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/journal" element={<RequireAuth><Journal /></RequireAuth>} />
        <Route path="/cuisine" element={<RequireAuth><Cuisine /></RequireAuth>} />
        <Route path="/prog" element={<RequireAuth><TrainingPrograms /></RequireAuth>} />
        <Route path="/coach" element={<RequireAuth><Coach /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
