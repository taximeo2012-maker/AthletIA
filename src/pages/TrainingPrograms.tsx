import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, limit, updateDoc } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';
import { generateContentWithRetry } from '../lib/aiUtils';
import { Zap, Calendar, Target, ChevronRight, Loader2, Trash2, Plus, ArrowLeft, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ScrollArea } from '../../components/ui/scroll-area';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export function TrainingPrograms() {
  const [programs, setPrograms] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [goal, setGoal] = useState('');
  const [duration, setDuration] = useState<string | number>(4);
  const [durationUnit, setDurationUnit] = useState<'days' | 'weeks'>('weeks');
  const [selectedProgram, setSelectedProgram] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, `users/${auth.currentUser.uid}/trainingPrograms`), 
      orderBy('createdAt', 'desc')
    );
    const unSub = onSnapshot(q, (snap) => {
      setPrograms(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error fetching programs:", error);
    });
    return () => unSub();
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || !auth.currentUser) return;

    const finalDuration = parseInt(duration.toString()) || 1;
    setIsGenerating(true);
    setShowForm(false);
    setErrorMsg(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
Tu es un coach sportif expert de haut niveau.
Génère un programme d'entraînement de ${finalDuration} ${durationUnit === 'weeks' ? 'SEMAINES' : 'JOURS'} pour l'objectif suivant : "${goal}"

Réponds EXCLUSIVEMENT en JSON avec cette structure :
{
  "title": "Titre du programme",
  "weeks": [
    {
      "weekNumber": 1,
      "days": [
        { "day": "Lundi", "type": "Repos / Course / Musculation", "description": "Détail court" },
        ...
      ]
    }
  ]
}
Note: Si l'unité est en JOURS, regroupe les jours dans la structure "weeks" de manière logique (ex: par tranches de 7 jours si possible).
Assure-toi que le programme est progressif et réaliste. Réponds en FRANÇAIS.
`;

      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text.trim());
      
      await addDoc(collection(db, `users/${auth.currentUser.uid}/trainingPrograms`), {
        title: result.title,
        goal: goal,
        duration: finalDuration,
        durationUnit: durationUnit,
        weeksJson: JSON.stringify(result.weeks),
        createdAt: new Date().toISOString()
      });

      setGoal('');
    } catch (err: any) {
      console.error("Error generating program:", err);
      const errStr = JSON.stringify(err).toUpperCase();
      const isRateLimit = err.message?.includes("429") || 
                         err.message?.includes("RESOURCE_EXHAUSTED") || 
                         errStr.includes("429") || 
                         errStr.includes("RESOURCE_EXHAUSTED") ||
                         errStr.includes("QUOTA");

      if (isRateLimit) {
        setErrorMsg("Quota limité ! Le coach IA a atteint sa limite pour aujourd'hui. Réessaie dans quelques instants ou demain.");
      } else {
        setErrorMsg("Erreur lors de la génération. Vérifie ta connexion ou modifie ton objectif.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, `users/${auth.currentUser.uid}/trainingPrograms`, id));
      if (selectedProgram?.id === id) setSelectedProgram(null);
    } catch (error) { console.error(error); }
  };

  return (
    <div className="flex flex-col h-full bg-[#0F1115]">
      <div className="p-6 pt-10 pb-4 shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
             {selectedProgram ? (
               <button onClick={() => setSelectedProgram(null)} className="p-2 bg-white/5 rounded-full text-slate-400 hover:text-white transition">
                 <ArrowLeft size={20} />
               </button>
             ) : (
               <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                 <Calendar size={20} />
               </div>
             )}
            <h1 className="text-2xl font-black italic uppercase tracking-tighter text-white">Programmes</h1>
          </div>
          {!selectedProgram && !isGenerating && (
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowForm(true)}
              className="bg-orange-500 p-2.5 rounded-full text-white shadow-lg shadow-orange-500/20"
            >
              <Plus size={20} />
            </motion.button>
          )}
        </div>

        <AnimatePresence>
          {isGenerating && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="bg-[#1A1C23] border border-orange-500/30 p-6 rounded-3xl mb-6 relative overflow-hidden"
            >
               <motion.div 
                animate={{ x: ['-100%', '100%'] }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute top-0 left-0 h-1 bg-gradient-to-r from-transparent via-orange-500 to-transparent w-full"
               />
               <div className="flex items-center space-x-4">
                 <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center">
                    <Loader2 size={24} className="text-orange-500 animate-spin" />
                 </div>
                 <div>
                   <h3 className="text-sm font-black uppercase tracking-widest text-white">Génération IA...</h3>
                   <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">Ton coach conçoit ton plan personnalisé</p>
                 </div>
               </div>
            </motion.div>
          )}

          {errorMsg && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl mb-6 flex items-start space-x-3"
            >
               <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
               <div className="flex-1">
                 <p className="text-xs font-bold text-red-100">{errorMsg}</p>
                 <button onClick={() => { setErrorMsg(null); setShowForm(true); }} className="text-[10px] font-black uppercase tracking-widest text-red-500 mt-2 hover:underline">Réessayer</button>
               </div>
            </motion.div>
          )}

          {showForm && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1A1C23] border border-white/5 p-6 rounded-3xl mb-6 shadow-2xl"
            >
               <form onSubmit={handleGenerate}>
                  <label className="text-[10px] font-black uppercase tracking-widest text-orange-500 block mb-3 pl-1">Quel est ton objectif ?</label>
                  <textarea 
                    value={goal} onChange={(e)=>setGoal(e.target.value)}
                    required rows={2}
                    placeholder="Ex: Passer sous les 50min au 10km, Perdre 2kg ce mois-ci..."
                    className="w-full bg-[#0F1115] border border-white/10 rounded-2xl p-4 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors mb-4 placeholder:text-slate-600"
                  />
                  
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2 pl-1">Durée</label>
                      <input 
                        type="number" 
                        min="1" 
                        max={durationUnit === 'weeks' ? 52 : 365}
                        value={duration} 
                        onChange={(e) => setDuration(e.target.value)}
                        className="w-full bg-[#0F1115] border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2 pl-1">Unité</label>
                      <select 
                        value={durationUnit} 
                        onChange={(e) => setDurationUnit(e.target.value as any)}
                        className="w-full bg-[#0F1115] border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-orange-500 transition-colors"
                      >
                        <option value="weeks">Semaines</option>
                        <option value="days">Jours</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex space-x-3">
                    <button type="button" onClick={()=>setShowForm(false)} className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-white/5 rounded-xl hover:bg-white/10 transition">Annuler</button>
                    <button type="submit" className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest text-white bg-orange-500 rounded-xl shadow-lg shadow-orange-500/20 flex items-center justify-center space-x-2">
                       <Zap size={12} fill="white" />
                       <span>Générer avec IA</span>
                    </button>
                  </div>
               </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 px-6 pb-20 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <AnimatePresence mode="wait">
          {!selectedProgram ? (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {programs.length === 0 && !isGenerating && !showForm && (
                <div className="text-center py-20 opacity-50">
                   <Target size={48} className="mx-auto mb-4 text-slate-600" />
                   <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Aucun programme actif</p>
                </div>
              )}
              {programs.map((prog, i) => (
                <motion.div 
                  key={prog.id}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                  onClick={() => setSelectedProgram(prog)}
                  className="bg-[#1A1C23] border border-white/5 p-5 rounded-3xl group cursor-pointer hover:border-orange-500/30 transition-all relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-2 relative z-10">
                    <div>
                      <h3 className="font-bold text-white text-sm tracking-tight">{prog.title}</h3>
                      <p className="text-[10px] font-bold text-slate-500 uppercase mt-1">Objectif: {prog.goal}</p>
                    </div>
                    <button onClick={(e) => handleDelete(prog.id, e)} className="p-2 rounded-xl bg-white/5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-all">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-4 relative z-10">
                     <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-white/5 rounded-lg text-slate-400">
                       {prog.duration || 4} {prog.durationUnit === 'days' ? 'Jours' : 'Semaines'} • IA Master
                     </span>
                     <ChevronRight size={16} className="text-slate-600 group-hover:text-orange-500 transition-colors" />
                  </div>
                  <div className="absolute right-0 bottom-0 p-1 opacity-5 transform translate-x-4 translate-y-4">
                    <Zap size={80} />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <ProgramDetail program={selectedProgram} onDelete={handleDelete} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProgramDetail({ program, onDelete }: { program: any, onDelete: (id: string, e: any) => void }) {
  const weeks = JSON.parse(program.weeksJson);
  const [activeWeek, setActiveWeek] = useState(1);
  const [modInstruction, setModInstruction] = useState('');
  const [isModifying, setIsModifying] = useState(false);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modInstruction.trim() || !auth.currentUser) return;
    
    setIsModifying(true);
    setErrorHeader(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
Tu es un coach sportif expert de haut niveau.
Voici un programme d'entraînement existant :
${program.weeksJson}

L'utilisateur souhaite le modifier avec cette instruction : "${modInstruction}"
Conserve la structure actuelle mais applique les changements demandés.

Réponds EXCLUSIVEMENT en JSON avec la structure mise à jour des semaines :
[
  {
    "weekNumber": 1,
    "days": [
      { "day": "Lundi", "type": "...", "description": "..." }
    ]
  }
]
`;
      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const updatedWeeks = JSON.parse(response.text.trim());
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/trainingPrograms`, program.id), {
        weeksJson: JSON.stringify(updatedWeeks),
        updatedAt: new Date().toISOString()
      });
      setModInstruction('');
    } catch (err) {
      console.error(err);
      setErrorHeader("Erreur lors de la modification. Réessaie !");
    } finally {
      setIsModifying(false);
    }
  };

  return (
    <motion.div 
      key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
      className="pb-32"
    >
       <div className="bg-gradient-to-br from-orange-500/20 to-red-500/10 border border-orange-500/30 rounded-3xl p-6 mb-6 relative">
          <button 
            onClick={(e) => onDelete(program.id, e)}
            className="absolute top-4 right-4 p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-lg"
          >
            <Trash2 size={16} />
          </button>
          <h2 className="text-xl font-black text-white italic uppercase tracking-tighter mb-2 pr-10">{program.title}</h2>
          <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">{program.goal}</p>
       </div>

       <div className="bg-[#1A1C23] border border-white/5 p-4 rounded-2xl mb-8">
          <form onSubmit={handleAdjust} className="relative">
            <input 
              value={modInstruction}
              onChange={(e) => setModInstruction(e.target.value)}
              placeholder="Ex: Rends la semaine 1 plus facile..."
              className="w-full bg-[#0F1115] border border-white/10 rounded-xl py-3 pl-4 pr-12 text-xs text-white focus:outline-none focus:border-orange-500 transition-colors"
            />
            <button 
              type="submit" 
              disabled={isModifying || !modInstruction.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white disabled:opacity-50"
            >
              {isModifying ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            </button>
          </form>
          {errorHeader && <p className="text-[10px] font-bold text-red-500 mt-2 ml-1">{errorHeader}</p>}
       </div>

       <div className="flex space-x-2 mb-8 bg-[#1A1C23] p-1.5 rounded-2xl border border-white/5 overflow-x-auto scrollbar-hide">
          {weeks.map((w: any) => (
            <button 
              key={w.weekNumber}
              onClick={() => setActiveWeek(w.weekNumber)}
              className={`flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeWeek === w.weekNumber ? 'bg-orange-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Sem. {w.weekNumber}
            </button>
          ))}
       </div>

       <div className="space-y-4">
          {weeks.find((w: any) => w.weekNumber === activeWeek)?.days.map((day: any, i: number) => (
             <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                key={i} 
                className="bg-[#1A1C23] p-4 rounded-2xl border border-white/5 flex items-start space-x-4"
             >
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex flex-col items-center justify-center shrink-0">
                   <span className="text-[8px] font-black uppercase">{day.day.substring(0,3)}</span>
                </div>
                <div>
                   <span className="text-[9px] font-black uppercase tracking-widest text-[#FC4C02] mb-1 block">{day.type}</span>
                   <p className="text-sm font-bold text-white leading-tight">{day.description}</p>
                </div>
             </motion.div>
          ))}
       </div>
    </motion.div>
  );
}
