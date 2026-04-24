import { useEffect, useState, useRef } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs, addDoc, orderBy, limit } from 'firebase/firestore';
import { Activity, Flame, ChevronRight, RefreshCw, Heart, Brain, CheckCircle2, Trophy, Settings, Smile, Target, MessageSquare, Zap, Map, TrendingUp, CloudRain, ShoppingCart, Utensils } from 'lucide-react';
import { format, subDays, isSameDay, isYesterday, setHours } from 'date-fns';
import { fr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { GoogleGenAI } from '@google/genai';
import { generateContentWithRetry } from '../lib/aiUtils';
import * as d3 from 'd3';

import { ScrollArea } from '../../components/ui/scroll-area';

let streakSoundPlayedThisSession = false;

const ALL_BADGES = [
  { id: 'STREAK_3', label: 'Série de 3j', icon: Flame },
  { id: 'STREAK_7', label: 'Mental d\'Acier', icon: Trophy },
  { id: 'DIST_50', label: 'Explorateur (50km)', icon: Zap },
  { id: 'FIRST_10K', label: 'Dépassement (10km)', icon: Target },
];

export function Dashboard() {
  const [userDoc, setUserDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectingFit, setConnectingFit] = useState(false);
  const [stravaActivities, setStravaActivities] = useState<any[]>([]);
  const [analyzingStravaId, setAnalyzingStravaId] = useState<string | null>(null);
  const [importedStravaIds, setImportedStravaIds] = useState<string[]>([]);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const [badges, setBadges] = useState<any[]>([]);
  const [newBadge, setNewBadge] = useState<any>(null);
  const [aiTone, setAiTone] = useState<string>('encouraging');
  const [showToneSettings, setShowToneSettings] = useState(false);
  const [performancePredictions, setPerformancePredictions] = useState<Record<string, string> | null>(null);
  const [correlationData, setCorrelationData] = useState<any[]>([]);
  const d3Container = useRef<SVGSVGElement>(null);
  const [totalKm, setTotalKm] = useState(0);
  const [weather, setWeather] = useState<any>(null);

  const STREAK_SOUND_URL = "https://assets.mixkit.co/active_storage/sfx/2016/2016-preview.mp3";

  useEffect(() => {
    const fetchUserAndData = async () => {
      if (!auth.currentUser) return;
      
      const ref = doc(db, 'users', auth.currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setUserDoc(data);
        if (data.aiTone) setAiTone(data.aiTone);
        if (data.stravaToken) {
          fetchStravaActivities(data.stravaToken);
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

      // For streak, we look back further (30 days)
      const monthStarts = subDays(today, 29);
      monthStarts.setHours(0,0,0,0);
      const monthStartsStr = monthStarts.toISOString();

      // ... Badges ...
      const badgesQ = query(collection(db, `users/${auth.currentUser.uid}/badges`));
      const bSnap = await getDocs(badgesQ);
      const userBadges = bSnap.docs.map(d=>d.data());
      setBadges(userBadges);

      // ... Meals ...
      const mealsQ = query(collection(db, `users/${auth.currentUser.uid}/meals`), where('recordedAt', '>=', weekStartsStr));
      const mSnap = await getDocs(mealsQ);
      const mealsInfo = mSnap.docs.map(d=>d.data());

      // ... Activities (30 days for streak calculation) ...
      const actQ = query(collection(db, `users/${auth.currentUser.uid}/activities`), where('recordedAt', '>=', monthStartsStr));
      const aSnap = await getDocs(actQ);
      const actsInfo = aSnap.docs.map(d=>d.data());
      
      // Calculate Streak
      const currentStreak = calculateCurrentStreak(actsInfo);

      // Total KM for Virtual Quest
      const total = actsInfo.reduce((acc, curr) => acc + (curr.distance || 0), 0);
      setTotalKm(total);

      // Mock Weather fetch (could be real if we had a City in user profile)
      setWeather({
        temp: 18,
        condition: 'Ensoleillé',
        icon: Smile,
        advice: "Conditions parfaites pour ta séance prévue ! Profite du soleil."
      });

      // Check Badges
      checkAndAwardBadges(actsInfo, currentStreak, userBadges);

      // Keep track of which strava acts are already imported
      const importedIds = actsInfo.filter(a => a.source === 'strava' && a.sourceId).map(a => a.sourceId);
      setImportedStravaIds(importedIds);

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
      
      // Prepare correlation data for D3 (Intensity vs Calories)
      const corr = actsInfo.map(a => ({
        intensity: a.avgHr ? (a.avgHr > 160 ? 3 : a.avgHr > 130 ? 2 : 1) : 1,
        calories: a.calories || 0,
        name: a.name
      })).filter(d => d.calories > 0);
      setCorrelationData(corr);

      // Simple Performance Prediction calculation
      if (actsInfo.length > 0) {
        const runActs = actsInfo.filter(a => a.sportType?.toLowerCase().includes('run') || a.sport?.toLowerCase().includes('run'));
        if (runActs.length > 0) {
          const avgPace = runActs.reduce((acc, curr) => acc + (curr.average_speed || (curr.distance && curr.duration ? (curr.distance * 1000) / (curr.duration * 60) : 0)), 0) / runActs.length;
          // Riegel's formula: T2 = T1 * (D2 / D1)^1.06
          // Assuming a standard 1km baseline if we have avgPace (m/s)
          const time1km = 1000 / avgPace;
          const predict10k = time1km * Math.pow(10, 1.06);
          const predict5k = time1km * Math.pow(5, 1.06);
          setPerformancePredictions({
            '5km': formatTime(predict5k),
            '10km': formatTime(predict10k),
            'Semi': formatTime(time1km * Math.pow(21.1, 1.06))
          });
        }
      }
    } catch(err) {
      console.error(err);
    }
  };

  const calculateCurrentStreak = (activities: any[]) => {
    if (activities.length === 0) {
      setStreak(0);
      return 0;
    }

    // Sort by date DESC
    const dates = activities
      .map(a => new Date(a.recordedAt).setHours(0,0,0,0))
      .sort((a,b) => b - a);
    
    // Unique dates only
    const uniqueDates = Array.from(new Set(dates));
    
    const today = new Date().setHours(0,0,0,0);
    const yesterday = subDays(new Date(), 1).setHours(0,0,0,0);

    // If latest activity is older than yesterday, streak is broken
    if (uniqueDates[0] < yesterday) {
      setStreak(0);
      return 0;
    }

    let currentStreak = 0;
    let expectedDate = uniqueDates[0] === today ? today : yesterday;

    for (let i = 0; i < uniqueDates.length; i++) {
      if (uniqueDates[i] === subDays(new Date(expectedDate), currentStreak).setHours(0,0,0,0)) {
        currentStreak++;
      } else {
        break;
      }
    }

    setStreak(currentStreak);
    
    // Play sound if streak is > 0 and not played yet in this session
    if (currentStreak > 0 && !streakSoundPlayedThisSession) {
      const audio = new Audio(STREAK_SOUND_URL);
      audio.volume = 0.4;
      audio.play().catch(e => console.log("Audio play blocked", e));
      streakSoundPlayedThisSession = true;
    }
    return currentStreak;
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // D3 Correlation Chart Effect
  useEffect(() => {
    if (correlationData.length > 0 && d3Container.current) {
      const margin = { top: 10, right: 10, bottom: 20, left: 30 };
      const width = 300 - margin.left - margin.right;
      const height = 150 - margin.top - margin.bottom;

      d3.select(d3Container.current).selectAll("*").remove();

      const svg = d3.select(d3Container.current)
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const x = d3.scaleLinear()
        .domain([0, 4])
        .range([0, width]);

      const y = d3.scaleLinear()
        .domain([0, d3.max(correlationData, d => d.calories) || 1000])
        .range([height, 0]);

      svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(3))
        .attr("class", "text-[8px] text-slate-500 opacity-30");

      svg.append("g")
        .call(d3.axisLeft(y).ticks(5))
        .attr("class", "text-[8px] text-slate-500 opacity-30");

      svg.selectAll("dot")
        .data(correlationData)
        .enter()
        .append("circle")
        .attr("cx", d => x(d.intensity))
        .attr("cy", d => y(d.calories))
        .attr("r", 4)
        .style("fill", "#f97316")
        .style("opacity", 0.6)
        .attr("filter", "drop-shadow(0 0 5px rgba(249,115,22,0.4))");
    }
  }, [correlationData]);

  const checkAndAwardBadges = async (activities: any[], currentStreak: number, existingBadges: any[]) => {
    if (!auth.currentUser) return;
    
    const awardBadge = async (badgeId: string, label: string, icon: string) => {
      if (existingBadges.find(b => b.badgeId === badgeId)) return;
      
      const newBadgeData = {
        badgeId,
        label,
        icon,
        unlockedAt: new Date().toISOString()
      };
      
      try {
        await addDoc(collection(db, `users/${auth.currentUser!.uid}/badges`), newBadgeData);
        setBadges(prev => [...prev, newBadgeData]);
        setNewBadge(newBadgeData);
        
        // Play success sound
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3");
        audio.volume = 0.5;
        audio.play().catch(e => {});

        setTimeout(() => setNewBadge(null), 5000);
      } catch (err) { console.error(err); }
    };

    // streak badges
    if (currentStreak >= 3) await awardBadge('STREAK_3', 'Série de 3 jours', 'Flame');
    if (currentStreak >= 7) await awardBadge('STREAK_7', 'Série de 7 jours (Guerrier)', 'Flame');

    // distance badges
    const totalDist = activities.reduce((acc, curr) => acc + (curr.distance || 0), 0);
    if (totalDist >= 50) await awardBadge('DIST_50', '50km parcourus', 'Trophy');
    
    const has10km = activities.some(a => a.distance >= 10);
    if (has10km) await awardBadge('FIRST_10K', 'Premier 10km franchi', 'Zap');
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

  const handleUpdateTone = async (newTone: string) => {
    if (!auth.currentUser) return;
    setAiTone(newTone);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        aiTone: newTone,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error updating tone:", err);
    }
  };

  const handleAnalyzeStrava = async (act: any) => {
    if (!auth.currentUser) return;
    setAnalyzingStravaId(act.id.toString());
    
    try {
      const durationMin = Math.round(act.moving_time / 60);
      const distanceKm = +(act.distance / 1000).toFixed(2);
      const summary = {
        distance_km: distanceKm,
        duration_min: durationMin,
        avg_hr: act.average_heartrate || 0,
        max_hr: act.max_heartrate || 0,
        pace_min_km: (act.average_speed && act.average_speed > 0) ? +(60 / act.average_speed).toFixed(2) : 0, 
        sport: act.type
      };

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const tonePrompts: Record<string, string> = {
        encouraging: "Tu es très encourageant, positif et motivant. Utilise des mots inspirants.",
        direct: "Tu es très direct, analytique et factuel. Pas de fioritures, juste les faits et ce qu'il faut améliorer.",
        humorous: "Tu es drôle, un peu sarcastique et plein d'esprit. Utilise l'humour pour motiver."
      };

      const prompt = `
Tu es AthletIA, un coach sportif expert.
${tonePrompts[aiTone] || tonePrompts.encouraging}
Analyse les données Strava de l'athlète :
${JSON.stringify(summary)}

Génère une réponse structurée en JSON EXACTEMENT avec ce format:
{
  "name": "Titre stylé et motivant pour la séance (ex: Run du matin - Allure de croisière)",
  "insights": "Ton analyse de coach (points forts, points faibles ou remarque sur la FC. Sois TRÈS direct, punchy, 3 phrases max)."
}
`;
      const aiResponse = await generateContentWithRetry(ai, {
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });
      
      const result = JSON.parse(aiResponse.text.trim());
      
      await addDoc(collection(db, `users/${auth.currentUser.uid}/activities`), {
         name: result.name || act.name,
         sportType: summary.sport || "Workout",
         source: 'strava',
         sourceId: act.id.toString(),
         duration: summary.duration_min,
         distance: summary.distance_km,
         avgHr: summary.avg_hr,
         maxHr: summary.max_hr,
         intensity: summary.avg_hr > 160 ? "Intense" : summary.avg_hr > 130 ? "Modérée" : "Légère",
         calories: Math.round(summary.duration_min * 10), // estimation
         insights: result.insights,
         recordedAt: act.start_date || new Date().toISOString()
      });

      setImportedStravaIds(prev => [...prev, act.id.toString()]);
      await fetchJournalData(); // refresh graphs

    } catch (err) {
      console.error(err);
      alert("Erreur lors de l'analyse Strava.");
    } finally {
      setAnalyzingStravaId(null);
    }
  };

  const handleStravaConnect = async () => {
    setConnecting(true);
    try {
      const sessionId = Math.random().toString(36).substring(2, 15);
      const res = await fetch(`/api/auth/strava/url?origin=${encodeURIComponent(window.location.origin)}&sessionId=${sessionId}`);
      const { url } = await res.json();
      const popup = window.open(url, 'strava_auth', 'width=600,height=700');
      
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        setConnecting(false);
        alert("Le pop-up de connexion Strava a été bloqué par ton navigateur. Merci de l'autoriser pour continuer.");
        return;
      }

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
    visible: { 
      opacity: 1, 
      y: 0, 
      transition: { 
        type: "spring", 
        stiffness: 300, 
        damping: 24 
      } as any
    }
  };

  return (
    <ScrollArea className="h-full">
      <motion.div 
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="p-6 pb-8"
      >
        <AnimatePresence>
          {showToneSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center">
                      <MessageSquare size={16} className="mr-2 text-orange-500" />
                      Personnalité du Coach
                    </h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Choisis le ton des analyses AthletIA</p>
                  </div>
                  <button onClick={() => setShowToneSettings(false)} className="text-slate-500 hover:text-white transition-colors">
                    <CheckCircle2 size={20} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'encouraging', label: 'Encourageant', icon: Smile, color: 'bg-green-500/10 text-green-500 border-green-500/20' },
                    { id: 'direct', label: 'Direct', icon: Target, color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
                    { id: 'humorous', label: 'Drôle', icon: Heart, color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
                  ].map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => handleUpdateTone(tone.id)}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all ${
                        aiTone === tone.id 
                          ? 'bg-gradient-to-br from-orange-500/20 to-red-500/20 border-orange-500/50 text-white ring-1 ring-orange-500/50 shadow-lg' 
                          : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      <tone.icon size={24} className={`mb-2 ${aiTone === tone.id ? 'text-orange-500' : 'text-slate-500'}`} />
                      <span className="text-[10px] font-black uppercase tracking-widest">{tone.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {newBadge && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: -100 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 50 }}
              className="fixed top-10 left-6 right-6 z-[100] flex justify-center"
            >
              <div className="bg-gradient-to-br from-orange-500 to-red-600 p-0.5 rounded-3xl shadow-[0_20px_50px_rgba(249,115,22,0.5)] w-full max-w-sm">
                <div className="bg-[#1A1C23] rounded-[22px] p-6 flex flex-col items-center text-center">
                  <motion.div 
                    animate={{ rotate: [0, 10, -10, 10, 0], scale: [1, 1.2, 1] }} 
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center text-white mb-4 shadow-lg shadow-orange-500/30"
                  >
                    <Trophy size={32} />
                  </motion.div>
                  <h3 className="text-xl font-black italic uppercase tracking-tighter text-white mb-1">Nouveau Trophée !</h3>
                  <p className="text-orange-500 font-bold uppercase tracking-widest text-[10px] mb-3">{newBadge.label}</p>
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 4.8 }}
                      className="h-full bg-orange-500"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.header variants={itemVariants} className="mb-8 pt-4 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white mb-1">
              Hello, <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-red-500">{auth.currentUser?.displayName?.split(' ')[0]}</span>
            </h1>
            <p className="text-sm text-slate-400 font-medium tracking-wide uppercase">{format(new Date(), 'EEEE d MMMM', { locale: fr })}</p>
          </div>

          <div className="flex items-center space-x-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowToneSettings(!showToneSettings)}
              className={`p-3 rounded-2xl border transition-all ${showToneSettings ? 'bg-orange-500 border-orange-400 text-white shadow-lg shadow-orange-500/20' : 'bg-[#1A1C23] border-white/5 text-slate-400'}`}
            >
              <Settings size={20} className={showToneSettings ? "animate-spin-slow" : ""} />
            </motion.button>

            {streak > 0 && (
            <motion.div 
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              whileHover={{ scale: 1.1 }}
              className="flex flex-col items-center"
            >
              <div className="relative">
                <motion.div 
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 0.8, 0.5]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 bg-orange-500 blur-xl rounded-full"
                />
                <div className="relative bg-[#1A1C23] border border-orange-500/30 px-4 py-2 rounded-2xl flex items-center space-x-2 shadow-2xl">
                  <motion.div
                    animate={{ y: [0, -2, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Flame size={20} className="text-orange-500 fill-orange-500" />
                  </motion.div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-black italic tracking-tighter text-white leading-none">{streak}</span>
                    <span className="text-[8px] font-bold text-orange-500 uppercase tracking-widest">JOURS</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          </div>
        </motion.header>

      <motion.div variants={itemVariants} className="mb-8 overflow-hidden">
          <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center">
             <Trophy size={12} className="mr-2 text-orange-500" />
             Mes Trophées
          </h2>
          <div className="flex space-x-3 overflow-x-auto pb-2 scrollbar-hide">
            {ALL_BADGES.map((badge, i) => {
              const isUnlocked = badges.some(b => b.badgeId === badge.id);
              return (
                <motion.div 
                  key={badge.id}
                  initial={{ opacity: 0, scale: 0.8 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  transition={{ delay: i * 0.1 }}
                  className={`flex-shrink-0 w-24 rounded-2xl p-3 flex flex-col items-center text-center shadow-lg border transition-all ${
                    isUnlocked 
                      ? 'bg-[#1A1C23] border-orange-500/30' 
                      : 'bg-white/5 border-transparent grayscale opacity-40'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${
                    isUnlocked ? 'bg-orange-500/10 text-orange-500' : 'bg-slate-500/10 text-slate-500'
                  }`}>
                     <badge.icon size={20} />
                  </div>
                  <span className={`text-[8px] font-black uppercase leading-tight line-clamp-2 ${
                    isUnlocked ? 'text-slate-100' : 'text-slate-500'
                  }`}>{badge.label}</span>
                  {!isUnlocked && (
                    <div className="mt-1">
                      <div className="w-full h-0.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-slate-700 w-0" />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      
      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-1">
                <Map size={12} className="mr-2 text-green-500" />
                La Traversée du Pays
              </h2>
              <p className="text-sm font-bold text-white">Brest ➔ Strasbourg</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black italic text-orange-500 drop-shadow-sm">{totalKm.toFixed(1)}</span>
              <span className="text-[10px] font-bold text-slate-500 ml-1">KM</span>
            </div>
          </div>
          
          <div className="relative h-3 bg-white/5 rounded-full overflow-hidden mb-2">
            <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-orange-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.4)]" style={{ width: `${Math.min((totalKm / 1000) * 100, 100)}%` }}></div>
            <motion.div 
               animate={{ x: [0, 1000] }} 
               transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
               className="absolute top-0 left-0 w-20 h-full bg-white/10 skew-x-12"
            />
          </div>
          <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-slate-500">
            <span>Brest (0km)</span>
            <span>{1000 - totalKm > 0 ? `Encore ${(1000 - totalKm).toFixed(0)}km` : 'Arrivé ! 🏁'}</span>
            <span>Strasbourg (1000km)</span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute -right-4 -bottom-4 opacity-5">
             <CloudRain size={120} />
          </div>
          <h2 className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center mb-4">
            <CloudRain size={12} className="mr-2" />
            Météo-Coach AthletIA
          </h2>
          {weather && (
            <div className="flex items-center space-x-4">
              <div className="text-4xl font-black text-white">{weather.temp}°</div>
              <div>
                <span className="text-xs font-bold text-blue-300 block">{weather.condition}</span>
                <p className="text-[10px] font-medium text-slate-400 line-clamp-2 mt-1 italic">"{weather.advice}"</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-4">
            <TrendingUp size={12} className="mr-2 text-orange-500" />
            Corrélation Intensité / Kcal (D3.js)
          </h2>
          <div className="flex justify-center items-center">
            <svg ref={d3Container}></svg>
          </div>
          <p className="text-[8px] text-slate-500 uppercase font-bold text-center mt-2">Plus tu pousses (X), plus tu brûles (Y)</p>
        </div>

        {performancePredictions && (
          <div className="bg-[#1A1C23] border border-white/5 rounded-3xl p-5 shadow-xl relative overflow-hidden flex flex-col justify-between">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center mb-4">
              <Brain size={12} className="mr-2 text-cyan-500" />
              Prédiction de Performance AthletIA
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(performancePredictions).map(([dist, time]) => (
                <div key={dist} className="bg-white/5 rounded-2xl p-2 text-center border border-white/5">
                  <span className="text-[9px] font-black text-slate-500 uppercase block mb-1">{dist}</span>
                  <span className="text-sm font-black text-white italic">{time}</span>
                </div>
              ))}
            </div>
            <p className="text-[8px] text-cyan-500/60 uppercase font-black tracking-tighter mt-3 flex items-center">
              <Zap size={8} className="mr-1" /> Basé sur tes dernières sorties Strava
            </p>
          </div>
        )}
      </motion.div>

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
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} dy={10} />
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
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#64748b' }} dy={10} />
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
                  className="bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex flex-col group transition-colors relative"
                >
                  <div className="flex items-center justify-between z-10 w-full mb-3">
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FC4C02]/20 to-[#FC4C02]/5 flex items-center justify-center text-[#FC4C02] ring-1 ring-[#FC4C02]/20">
                         <Activity size={18} />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-sm tracking-tight line-clamp-1">{act.name}</h3>
                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5 text-[#FC4C02]">{new Date(act.start_date).toLocaleDateString()} • {(act.distance / 1000).toFixed(1)} km</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-lg font-black italic tracking-tighter text-white">{Math.round(act.moving_time / 60)}<span className="text-[9px] text-slate-500 ml-1">MIN</span></span>
                    </div>
                  </div>
                  
                  {importedStravaIds.includes(act.id.toString()) ? (
                     <div className="flex items-center justify-center w-full py-2 bg-[#FC4C02]/10 rounded-lg text-xs font-black uppercase text-[#FC4C02] tracking-widest border border-[#FC4C02]/20">
                        <CheckCircle2 size={14} className="mr-2" /> Analysé & Imporé
                     </div>
                  ) : (
                     <button
                        onClick={() => handleAnalyzeStrava(act)}
                        disabled={analyzingStravaId === act.id.toString()}
                        className="w-full py-2.5 rounded-lg flex items-center justify-center space-x-2 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 hover:from-cyan-500/20 hover:to-blue-500/10 border border-cyan-500/20 transition-all group-hover:border-cyan-500/40 text-cyan-400 disabled:opacity-50"
                     >
                        {analyzingStravaId === act.id.toString() ? (
                           <RefreshCw size={14} className="animate-spin" />
                        ) : (
                           <Brain size={14} />
                        )}
                        <span className="text-[10px] font-black uppercase tracking-widest">
                           {analyzingStravaId === act.id.toString() ? 'Génération IA...' : 'Analyse Coach IA'}
                        </span>
                     </button>
                  )}
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
            </div>
          </motion.div>
        </>
      )}
      </motion.div>
    </ScrollArea>
  );
}
