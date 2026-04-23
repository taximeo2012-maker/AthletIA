import { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { Activity, Flame, ChevronRight, RefreshCw, Smartphone, Heart } from 'lucide-react';
import { format, subDays, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { motion } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

import { ScrollArea } from '../../components/ui/scroll-area';

export function Dashboard() {
  const [userDoc, setUserDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectingFit, setConnectingFit] = useState(false);
  const [stravaActivities, setStravaActivities] = useState<any[]>([]);

  const [weeklyData, setWeeklyData] = useState<any[]>([]);

  useEffect(() => {
    const fetchUserAndData = async () => {
      if (!auth.currentUser) return;
      
      const ref = doc(db, 'users', auth.currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setUserDoc(snap.data());
        if (snap.data().stravaToken) {
          fetchStravaActivities(snap.data().stravaToken);
        }
      }

      await fetchJournalData();
      setLoading(false);
    };
    fetchUserAndData();
  }, []);

  const fetchJournalData = async () => {
    if (!auth.currentUser) return;
    try {
      const today = new Date();
      const weekStarts = subDays(today, 6);
      weekStarts.setHours(0,0,0,0);
      const weekStartsStr = weekStarts.toISOString();

      const mealsQ = query(collection(db, `users/${auth.currentUser.uid}/meals`), where('recordedAt', '>=', weekStartsStr));
      const mSnap = await getDocs(mealsQ);
      const mealsInfo = mSnap.docs.map(d=>d.data());

      const actQ = query(collection(db, `users/${auth.currentUser.uid}/activities`), where('recordedAt', '>=', weekStartsStr));
      const aSnap = await getDocs(actQ);
      const actsInfo = aSnap.docs.map(d=>d.data());

      const week = [];
      for(let i=6; i>=0; i--) {
        const d = subDays(today, i);
        const dayMeals = mealsInfo.filter(m => m.recordedAt && isSameDay(new Date(m.recordedAt), d));
        const dayActs = actsInfo.filter(a => a.recordedAt && isSameDay(new Date(a.recordedAt), d));
        
        let outGuesstimate = 0;
        dayActs.forEach(a => {
           if (a.calories) outGuesstimate += a.calories;
           else if (a.duration) outGuesstimate += (a.duration * 10);
        });

        week.push({
          day: format(d, 'EEE', {locale: fr}).substring(0,3),
          in: dayMeals.reduce((acc, curr) => acc + (curr.calories || 0), 0),
          out: outGuesstimate,
          duration: dayActs.reduce((acc, curr) => acc + (curr.duration || 0), 0)
        });
      }
      setWeeklyData(week);
    } catch(err) {
      console.error(err);
    }
  };

  const fetchStravaActivities = async (token: string) => {
    try {
      const res = await fetch('/api/strava/activities', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStravaActivities(data.slice(0, 3));
      }
    } catch(err) {
      console.error(err);
    }
  };

  const handleStravaConnect = async () => {
    setConnecting(true);
    try {
      const sessionId = Math.random().toString(36).substring(2, 15);
      const res = await fetch(`/api/auth/strava/url?origin=${encodeURIComponent(window.location.origin)}&sessionId=${sessionId}`);
      const { url } = await res.json();
      const popup = window.open(url, 'strava_auth', 'width=600,height=700');
      
      const pollTimer = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/auth/strava/poll?sessionId=${sessionId}`);
          const data = await pollRes.json();
          if (data.success && data.payload) {
            clearInterval(pollTimer);
            if (auth.currentUser) {
              const ref = doc(db, 'users', auth.currentUser.uid);
              await updateDoc(ref, {
                stravaToken: data.payload.access_token,
                stravaRefreshToken: data.payload.refresh_token,
                stravaExpiresAt: data.payload.expires_at,
                updatedAt: serverTimestamp()
              });
              setUserDoc((prev: any) => ({ ...prev, stravaToken: data.payload.access_token }));
              fetchStravaActivities(data.payload.access_token);
            }
            if (popup && !popup.closed) popup.close();
            setConnecting(false);
          }
        } catch (pollErr) { console.error("Polling error", pollErr); }
        if (popup?.closed && !connecting) { clearInterval(pollTimer); setConnecting(false); }
      }, 1500);
      setTimeout(() => { clearInterval(pollTimer); setConnecting(false); }, 300000);
    } catch (err) { console.error("Erreur Strava", err); setConnecting(false); }
  };

  const handleGoogleFitConnect = async () => {
    setConnectingFit(true);
    try {
      const sessionId = Math.random().toString(36).substring(2, 15);
      const res = await fetch(`/api/auth/google/url?origin=${encodeURIComponent(window.location.origin)}&sessionId=${sessionId}`);
      const { url } = await res.json();
      const popup = window.open(url, 'google_fit_auth', 'width=600,height=700');
      
      const pollTimer = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/auth/strava/poll?sessionId=${sessionId}`); 
          const data = await pollRes.json();
          if (data.success && data.payload) {
            clearInterval(pollTimer);
            if (auth.currentUser) {
              const ref = doc(db, 'users', auth.currentUser.uid);
              await updateDoc(ref, {
                googleFitToken: data.payload.access_token,
                googleFitRefreshToken: data.payload.refresh_token,
                googleFitExpiresAt: Date.now() + (data.payload.expires_in * 1000),
                updatedAt: serverTimestamp()
              });
              setUserDoc((prev: any) => ({ ...prev, googleFitToken: data.payload.access_token }));
            }
            if (popup && !popup.closed) popup.close();
            setConnectingFit(false);
          }
        } catch (pollErr) { console.error("Polling error", pollErr); }
        if (popup?.closed && !connectingFit) { clearInterval(pollTimer); setConnectingFit(false); }
      }, 1500);
      setTimeout(() => { clearInterval(pollTimer); setConnectingFit(false); }, 300000);
    } catch (err) { console.error("Erreur Google Fit", err); setConnectingFit(false); }
  };

  if (loading) return null;

  const isStravaConnected = !!userDoc?.stravaToken;
  const isGoogleFitConnected = !!userDoc?.googleFitToken;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <ScrollArea className="h-full">
      <motion.div 
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="p-6 pb-8"
      >
        <motion.header variants={itemVariants} className="mb-8 pt-4">
        <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white mb-1">
          Hello, <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-red-500">{auth.currentUser?.displayName?.split(' ')[0]}</span>
        </h1>
        <p className="text-sm text-slate-400 font-medium tracking-wide uppercase">{format(new Date(), 'EEEE d MMMM', { locale: fr })}</p>
      </motion.header>

      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 mr-2 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
            Balance Calorique
          </h2>
          <div className="h-40 w-full ml-[-15px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b', textTransform: 'uppercase' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f1115', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  labelStyle={{ color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' }}
                />
                <Area type="monotone" dataKey="in" name="Apport (kcal)" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorIn)" />
                <Area type="monotone" dataKey="out" name="Dépense (kcal)" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#colorOut)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-2 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
            Performance (Temps)
          </h2>
          <div className="h-40 w-full ml-[-15px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b', textTransform: 'uppercase' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} width={30} />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{ backgroundColor: '#0f1115', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold' }}
                  labelStyle={{ display: 'none' }}
                />
                <Bar dataKey="duration" name="Minutes" fill="#ef4444" radius={[4, 4, 0, 0]}>
                  {weeklyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.duration > 30 ? '#ef4444' : '#fca5a5'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {!isStravaConnected ? (
        <motion.div variants={itemVariants} className="bg-gradient-to-br from-orange-500/10 to-red-500/5 rounded-3xl p-6 border border-orange-500/20 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4">
            <Activity size={100} />
          </div>
          <div className="w-12 h-12 bg-gradient-to-tr from-orange-500 to-orange-600 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-500/30">
            <Activity size={24} />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">Connecte Strava</h2>
          <p className="text-sm text-slate-300 mb-6 relative z-10 leading-relaxed">Pousse tes limites : synchronise tes données pour débloquer ton coaching algorithmique.</p>
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleStravaConnect}
            disabled={connecting}
            className="w-full bg-[#FC4C02] text-white font-bold tracking-wide py-4 px-4 rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-[#FC4C02]/20 hover:shadow-[#FC4C02]/40 transition-shadow disabled:opacity-70"
          >
            {connecting ? <RefreshCw className="animate-spin" size={18} /> : null}
            <span>{connecting ? 'SYNCHRONISATION...' : 'CONNECTER MON REPERTOIRE STRAVA'}</span>
          </motion.button>
        </motion.div>
      ) : (
        <>
          <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 mb-8">
            <motion.div whileHover={{ y: -4 }} className="bg-gradient-to-br from-orange-500/10 to-transparent rounded-[24px] p-5 border border-orange-500/20 flex flex-col relative overflow-hidden">
              <div className="absolute -right-4 -bottom-4 opacity-[0.03]">
                 <Flame size={120} />
              </div>
              <div className="text-orange-400 mb-3 bg-orange-500/10 w-10 h-10 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(249,115,22,0.15)] ring-1 ring-orange-500/30">
                <Flame size={20} />
              </div>
              <span className="text-[10px] text-orange-200/60 font-bold tracking-widest uppercase mb-1 drop-shadow-sm">Calories Joules</span>
              <span className="text-3xl font-black text-white tracking-tighter">450 <span className="text-sm font-semibold text-orange-500">kcal</span></span>
            </motion.div>
            
            <motion.div whileHover={{ y: -4 }} className="bg-gradient-to-br from-cyan-500/10 to-transparent rounded-[24px] p-5 border border-cyan-500/20 flex flex-col relative overflow-hidden">
              <div className="absolute -right-4 -bottom-4 opacity-[0.03]">
                 <Activity size={120} />
              </div>
              <div className="text-cyan-400 mb-3 bg-cyan-500/10 w-10 h-10 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/30">
                <Activity size={20} />
              </div>
              <span className="text-[10px] text-cyan-200/60 font-bold tracking-widest uppercase mb-1 drop-shadow-sm">Rendement 7j</span>
              <span className="text-3xl font-black text-white tracking-tighter">{stravaActivities.length || 0}</span>
            </motion.div>
          </motion.div>

          <motion.div variants={itemVariants} className="mb-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-black text-slate-200 uppercase tracking-widest flex items-center">
                <span className="w-2 h-2 rounded-full bg-orange-500 mr-2 shadow-[0_0_8px_rgba(249,115,22,0.8)]"></span>
                Derniers efforts
              </h2>
            </div>
            
            <div className="space-y-3">
              {stravaActivities.length === 0 ? (
                <div className="text-sm text-slate-500 italic bg-[#1A1C23] p-6 rounded-2xl border border-white/5 text-center font-medium">Radar vide. À l'entraînement !</div>
              ) : stravaActivities.map((act, i) => (
                <motion.div 
                  key={act.id} 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, type: "spring", stiffness: 200 }}
                  whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.05)' }}
                  className="bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex items-center justify-between group cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FC4C02]/20 to-[#FC4C02]/5 flex items-center justify-center text-[#FC4C02] ring-1 ring-[#FC4C02]/20">
                       <Activity size={20} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm tracking-tight">{act.name}</h3>
                      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-0.5 text-[#FC4C02]">{new Date(act.start_date).toLocaleDateString()} • {(act.distance / 1000).toFixed(1)} km</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="block text-xl font-black italic tracking-tighter text-white">{Math.round(act.moving_time / 60)}<span className="text-[10px] text-slate-500 ml-1">MIN</span></span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div variants={itemVariants} className="mb-8">
            <h2 className="text-sm font-black text-slate-200 uppercase tracking-widest flex items-center mb-5">
               <span className="w-2 h-2 rounded-full bg-cyan-500 mr-2 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
               Physiologie & Bio
            </h2>
            <div className="space-y-3">
              
              {!isGoogleFitConnected ? (
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleGoogleFitConnect} 
                  disabled={connectingFit}
                  className="w-full bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex items-center justify-between hover:bg-white/5 transition text-left"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center ring-1 ring-red-500/20">
                      {connectingFit ? <RefreshCw size={18} className="animate-spin" /> : <Heart size={18} />}
                    </div>
                    <span className="font-bold tracking-tight text-white">Google Fit</span>
                  </div>
                  <span className="text-[10px] font-bold text-white bg-red-500 px-3 py-1.5 rounded-lg shadow-lg shadow-red-500/20 uppercase tracking-wider">Coupler</span>
                </motion.button>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  className="w-full bg-gradient-to-r from-red-500/10 to-transparent p-4 rounded-2xl border border-red-500/20 flex items-center justify-between text-left relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-red-500/10 to-transparent"></div>
                  <div className="flex items-center space-x-4 relative">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-400 to-red-600 text-white flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.4)]">
                      <Heart size={18} />
                    </div>
                    <div>
                      <span className="font-black italic uppercase tracking-tighter text-white block leading-tight">G-FIT Actif</span>
                      <span className="text-[10px] text-red-400 font-bold tracking-widest uppercase">Fréquence & Bio</span>
                    </div>
                  </div>
                  <div className="bg-[#0F1115] rounded-full p-2 border border-red-500/30 text-red-400 relative shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                    <Activity size={14} />
                  </div>
                </motion.div>
              )}
              
              <motion.button 
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => alert("Apple Santé: Limité au Web, télécharge l'app native.")} 
                className="w-full bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex items-center justify-between hover:bg-white/5 transition text-left"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-500/10 text-slate-400 flex items-center justify-center ring-1 ring-slate-500/20">
                    <Smartphone size={18} />
                  </div>
                  <span className="font-bold tracking-tight text-white">Apple Santé</span>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 uppercase tracking-wider">App Native</span>
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
      </motion.div>
    </ScrollArea>
  );
}
