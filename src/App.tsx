import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, addDoc, getDocs, query, where, orderBy, doc, setDoc, getDoc, Timestamp, deleteDoc } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase';
import { LogIn, ShieldAlert, Loader2, Sparkles, Save, CheckCircle, LogOut, Menu, X, LayoutDashboard, Swords, Users, UsersRound, Plus, Trash2, Edit3, BookOpen, History, BrainCircuit, FileText, Volume2, Trophy, Download, Settings, Eye, EyeOff, Power, Search, ArrowLeft, ArrowRightLeft, UserMinus, Archive, Copy } from 'lucide-react';

// --- SM-2 Algorithm ---

interface SM2Result {
  repetitions: number;
  easeFactor: number;
  interval: number;
  nextReviewDate: Date;
}

interface Cohort {
  id: string;
  name: string;
  join_code: string;
  theme_color: string;
  is_archived: boolean;
  created_at: string;
  student_count: number;
  boss_encounter_rate?: number;
  ai_strictness?: 'lenient' | 'standard' | 'honors';
}

interface QuestionBankItem {
  type: 'cloze' | 'application' | 'synonym_context';
  prompt_text: string;
  answer_text: string;
}

interface LearningItem {
  id: string;
  term: string;
  item_type: string;
  cohort_id?: string;
  target_classes?: string[];
  novel_node?: string;
  definition: string;
  part_of_speech: string;
  example_sentence?: string;
  fill_in_the_blank?: string;
  question_bank?: QuestionBankItem[];
  created_at: string;
  is_active: boolean;
  totalReviews?: number;
  masteryPercentage?: number;
}

function calculateSM2(
  quality: number,
  prevRepetitions: number,
  prevEaseFactor: number,
  prevInterval: number
): SM2Result {
  let repetitions: number;
  let easeFactor: number;
  let interval: number;

  if (quality >= 3) {
    if (prevRepetitions === 0) {
      interval = 1;
    } else if (prevRepetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(prevInterval * prevEaseFactor);
    }
    repetitions = prevRepetitions + 1;
    easeFactor = prevEaseFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  } else {
    repetitions = 0;
    interval = 1;
    easeFactor = prevEaseFactor;
  }

  if (easeFactor < 1.3) easeFactor = 1.3;

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  return {
    repetitions,
    easeFactor,
    interval,
    nextReviewDate,
  };
}

// --- Components ---

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentCohort, setCurrentCohort] = useState<string>('');
  const [isUpdatingCohort, setIsUpdatingCohort] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const role = localStorage.getItem('role');
  const token = localStorage.getItem('token');

  if (location.pathname === '/login' || !token) return null;

  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
      } catch (e) {}
    }
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/login');
  };

  const openSettings = async () => {
    setIsSettingsOpen(true);
    if (auth.currentUser && db) {
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          setCurrentCohort(userDoc.data().cohort_id || '');
        }
      } catch (e) {
        console.error("Error fetching cohort", e);
      }
    }
  };

  const handleUpdateCohort = async (newCohort: string) => {
    setIsUpdatingCohort(true);
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/user/set-cohort', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': token || ''
            },
            body: JSON.stringify({ cohortId: newCohort })
        });

        if (response.ok) {
            setToast({ message: 'Class updated successfully!', type: 'success' });
            setIsSettingsOpen(false);
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            alert('Failed to update class.');
        }
    } catch (e) {
        console.error(e);
        alert('An error occurred.');
    } finally {
        setIsUpdatingCohort(false);
    }
  };

  return (
    <nav className="bg-slate-950 border-b border-slate-800 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center group-hover:bg-indigo-400 transition-colors">
                <Swords className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">Vocab Arena</span>
            </Link>
            
            <div className="hidden md:flex items-center gap-4">
              {role === 'teacher' && (
                <Link 
                  to="/dashboard" 
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${location.pathname === '/dashboard' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
              )}
              <Link 
                to="/arena" 
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${location.pathname === '/arena' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900'}`}
              >
                <Swords className="w-4 h-4" />
                Arena
              </Link>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4">
             {role === 'student' && (
               <button
                 onClick={openSettings}
                 className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium transition-colors"
               >
                 <Settings className="w-4 h-4" />
                 Settings
               </button>
             )}
             <button 
              onClick={handleLogout}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-slate-400 hover:text-white p-2"
            >
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-slate-950 border-t border-slate-800 px-2 pt-2 pb-3 space-y-1">
          {role === 'teacher' && (
            <Link 
              to="/dashboard" 
              onClick={() => setIsMenuOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-slate-400 hover:text-white hover:bg-slate-900"
            >
              <LayoutDashboard className="w-5 h-5" />
              Dashboard
            </Link>
          )}
          <Link 
            to="/arena" 
            onClick={() => setIsMenuOpen(false)}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-slate-400 hover:text-white hover:bg-slate-900"
          >
            <Swords className="w-5 h-5" />
            Arena
          </Link>
          {role === 'student' && (
            <button 
              onClick={() => {
                setIsMenuOpen(false);
                openSettings();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-slate-400 hover:text-white hover:bg-slate-900"
            >
              <Settings className="w-5 h-5" />
              Settings
            </button>
          )}
          <button 
            onClick={() => {
              setIsMenuOpen(false);
              handleLogout();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium text-slate-400 hover:text-white hover:bg-slate-900"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4 relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              Student Settings
            </h2>

            <div className="space-y-6">
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Current Class</p>
                <p className="text-lg font-medium text-white">{currentCohort || 'Not Assigned'}</p>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-slate-400">Switch Class:</p>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => handleUpdateCohort('9th Grade Honors')}
                    disabled={isUpdatingCohort || currentCohort === '9th Grade Honors'}
                    className={`p-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                      currentCohort === '9th Grade Honors' 
                        ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300 cursor-default' 
                        : 'bg-slate-800 border-slate-700 hover:border-indigo-500 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    <span className="font-medium">9th Grade Honors</span>
                    {currentCohort === '9th Grade Honors' && <CheckCircle className="w-4 h-4 text-indigo-400" />}
                  </button>

                  <button
                    onClick={() => handleUpdateCohort('11th Grade Honors')}
                    disabled={isUpdatingCohort || currentCohort === '11th Grade Honors'}
                    className={`p-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                      currentCohort === '11th Grade Honors' 
                        ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300 cursor-default' 
                        : 'bg-slate-800 border-slate-700 hover:border-indigo-500 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    <span className="font-medium">11th Grade Honors</span>
                    {currentCohort === '11th Grade Honors' && <CheckCircle className="w-4 h-4 text-indigo-400" />}
                  </button>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex gap-3">
                <ShieldAlert className="w-5 h-5 text-yellow-500 shrink-0" />
                <p className="text-xs text-yellow-200/80 leading-relaxed">
                  Note: Changing your class will update your Daily Queue to the new vocabulary list.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-[110] px-6 py-3 rounded-lg shadow-2xl border flex items-center gap-3 animate-in slide-in-from-bottom-5 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-red-500/10 border-red-500/50 text-red-400'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          <span className="font-bold">{toast.message}</span>
        </div>
      )}
    </nav>
  );
}

function Login() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!isFirebaseConfigured()) {
      setError("Firebase is not configured. Please add your Firebase credentials to the Environment Variables.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email;

      // Domain restriction check
      if (!email?.endsWith('@nbend.k12.or.us')) {
        await signOut(auth);
        setError("Restricted to school domain only (@nbend.k12.or.us)");
        setIsLoading(false);
        return;
      }

      // Get Firebase ID Token
      const idToken = await result.user.getIdToken();
      
      const maxRetries = 3;
      let attempt = 0;

      const syncUser = async (): Promise<any> => {
        const response = await fetch('/api/v1/session', {
          method: 'POST',
          headers: {
            'X-Auth-Token': idToken,
            'Content-Type': 'application/json'
          }
        });

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to sync user with server');
          }
          return response.json();
        } else {
          const text = await response.text();
          if (text.includes("Please wait while your application starts") || text.includes("Starting Server")) {
            if (attempt < maxRetries) {
              attempt++;
              console.log(`Server is warming up (sync), retrying attempt ${attempt}...`);
              await new Promise(resolve => setTimeout(resolve, 3000));
              return syncUser();
            }
            throw new Error("The server is still starting up. Please try again in a few seconds.");
          }
          throw new Error('Failed to sync user with server: Unexpected response format');
        }
      };

      const data = await syncUser();
      
      // Store token and role
      localStorage.setItem('token', idToken);
      localStorage.setItem('role', data.role);

      // Redirect based on role
      if (data.role === 'teacher') {
        navigate('/dashboard');
      } else {
        navigate('/arena');
      }

    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === 'auth/unauthorized-domain') {
        setError(`This domain (${window.location.hostname}) is not authorized. Please add it to 'Authorized Domains' in the Firebase Console.`);
      } else {
        setError(err.message || "An error occurred during login.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700 text-center">
        <div className="w-20 h-20 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <LogIn className="w-10 h-10 text-indigo-400" />
        </div>
        
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Enter the Arena</h1>
        <p className="text-slate-400 mb-8">Sign in to start your learning journey.</p>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3 text-left">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="w-full bg-white text-slate-900 font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          <span>Log in with School Google Account</span>
        </button>

        <div className="mt-8 pt-6 border-t border-slate-700">
          <p className="text-xs text-slate-500 mb-4 uppercase tracking-widest font-semibold">Testing Tools</p>
          <button
            onClick={() => {
              localStorage.setItem('token', 'dev-token-nbend-2026');
              localStorage.setItem('role', 'teacher');
              window.location.href = '/dashboard';
            }}
            className="w-full bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white py-2 px-4 rounded-lg text-sm transition-colors border border-slate-600 border-dashed"
          >
            Enter as Teacher (Dev Mode)
          </button>
        </div>
      </div>
    </div>
  );
}

function Arena() {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [sessionState, setSessionState] = useState<'hub' | 'active' | 'victory' | 'boss'>('hub');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startTime, setStartTime] = useState<number>(0);
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);
  const [newRank, setNewRank] = useState('');
  const [showCohortModal, setShowCohortModal] = useState(false);
  const [isSettingCohort, setIsSettingCohort] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [slideDirection, setSlideDirection] = useState<'in' | 'out'>('in');
  const [studentSentence, setStudentSentence] = useState('');
  const [bossFeedback, setBossFeedback] = useState<{isCorrect: boolean, feedback: string, detailedAnalysis?: string, correction?: string, xpAwarded: number} | null>(null);
  const [cohortSettings, setCohortSettings] = useState<any>(null);
  const [isRetry, setIsRetry] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);

  const handleReveal = () => {
    setIsFlipping(true);
    setShowAnswer(true);
    setTimeout(() => setIsFlipping(false), 500);
  };

  useEffect(() => {
    checkCohort();
    fetchItems();
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    const userId = auth.currentUser?.uid || (localStorage.getItem('token') === 'dev-token-nbend-2026' ? 'dev-user' : null);
    if (!userId || !db) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserData(data);
        
        if (data.cohort_id) {
          const classDoc = await getDoc(doc(db, 'classes', data.cohort_id));
          if (classDoc.exists()) {
            setCohortSettings(classDoc.data());
          }
        }
      }
    } catch (e) {
      console.error("Error fetching user data:", e);
    }
  };

  const checkCohort = async () => {
    const userId = auth.currentUser?.uid || (localStorage.getItem('token') === 'dev-token-nbend-2026' ? 'dev-user' : null);
    if (!userId || !db) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (!userData.cohort_id) {
          setShowCohortModal(true);
        }
      }
    } catch (error) {
      console.error("Error checking cohort:", error);
    }
  };

  const handleJoinClass = async () => {
    if (!joinCode.trim()) return;
    setIsSettingCohort(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/user/join-class', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token || ''
        },
        body: JSON.stringify({ joinCode: joinCode.trim() })
      });

      if (response.ok) {
        setShowCohortModal(false);
        fetchItems(); // Refresh items for the new cohort
        fetchUserData(); // Refresh user data
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to join class. Please check the code.');
      }
    } catch (error) {
      console.error("Error joining class:", error);
      alert('An error occurred.');
    } finally {
      setIsSettingCohort(false);
    }
  };

  const fetchItems = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/study/queue', {
        headers: {
          'x-auth-token': token || ''
        }
      });

      if (response.ok) {
        const data = await response.json();
        setItems(data);
      } else {
        setError("Failed to load arena items.");
      }
    } catch (err: any) {
      console.error("Error fetching items:", err);
      setError("Failed to load arena items.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (items.length > 0 && items[currentIndex]) {
      const item = items[currentIndex];
      if (item.question_bank && item.question_bank.length > 0) {
        const randomIndex = Math.floor(Math.random() * item.question_bank.length);
        setCurrentQuestion(item.question_bank[randomIndex]);
      } else {
        // Fallback for legacy items without question_bank
        setCurrentQuestion({
          type: item.item_type === 'grammar' ? 'grammar' : 'cloze',
          prompt_text: item.item_type === 'grammar' ? item.incorrect_sentence : item.fill_in_the_blank,
          answer_text: item.item_type === 'grammar' ? item.corrected_sentence : item.example_sentence
        });
      }
    }
  }, [currentIndex, items]);

  const handleStartSession = () => {
    if (items.length > 0) {
      setCurrentIndex(0);
      setSessionXp(0);
      setStartTime(Date.now());
      setShowAnswer(false);
      setSlideDirection('in');
      setBossFeedback(null);
      setStudentSentence('');
      setIsRetry(false);
      setHintUsed(false);
      
      const firstItem = items[0];
      const encounterChance = (cohortSettings?.boss_encounter_rate || 15) / 100;
      const isBossEncounter = firstItem.item_type === 'vocab' && (Math.random() < encounterChance || (firstItem.progress?.easeFactor > 2.5));
      setSessionState(isBossEncounter ? 'boss' : 'active');
    }
  };

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleRating = async (quality: number) => {
    const userId = auth.currentUser?.uid || (localStorage.getItem('token') === 'dev-token-nbend-2026' ? 'dev-user' : null);
    const currentItem = items[currentIndex];
    if (!currentItem || !userId) return;
    setIsSubmitting(true);
    setShowAnswer(false);

    const responseTimeMs = Date.now() - startTime;

    try {
      const prevProgress = currentItem.progress || {
        repetitions: 0,
        easeFactor: 2.5,
        interval: 0
      };

      const result = calculateSM2(
        quality,
        prevProgress.repetitions,
        prevProgress.easeFactor,
        prevProgress.interval
      );

      // Call API to log review and update progress
      const token = localStorage.getItem('token');
      const response = await fetch('/api/study/log-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token || ''
        },
        body: JSON.stringify({
          itemId: currentItem.id,
          score: quality,
          responseTimeMs,
          sm2Result: {
            repetitions: result.repetitions,
            easeFactor: result.easeFactor,
            interval: result.interval,
            nextReviewDate: result.nextReviewDate.toISOString()
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSessionXp(prev => prev + (data.xpGained || 0));
        if (data.leveledUp) {
          setNewRank(data.newRank);
          setShowLevelUpModal(true);
        }
      }

      setSlideDirection('out');
      setTimeout(() => {
        setIsFlipping(false);
        if (currentIndex + 1 < items.length) {
          setCurrentIndex(prev => prev + 1);
          setShowAnswer(false);
          setStartTime(Date.now());
          setSlideDirection('in');
          setBossFeedback(null);
          setStudentSentence('');
          setIsRetry(false);
          setHintUsed(false);
          
          const nextItem = items[currentIndex + 1];
          const encounterChance = (cohortSettings?.boss_encounter_rate || 15) / 100;
          const isBossEncounter = nextItem.item_type === 'vocab' && (Math.random() < encounterChance || (nextItem.progress?.easeFactor > 2.5));
          setSessionState(isBossEncounter ? 'boss' : 'active');
        } else {
          setSessionState('victory');
          fetchUserData(); // Refresh user data for hub
        }
      }, 300);
    } catch (err) {
      console.error("Error saving progress:", err);
      alert("Failed to save progress.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitStrike = async () => {
    if (!studentSentence.trim()) return;
    setIsSubmitting(true);
    const token = localStorage.getItem('token');
    const currentItem = items[currentIndex];

    try {
      const response = await fetch('/api/study/evaluate-sentence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token || ''
        },
        body: JSON.stringify({
          term: currentItem.term,
          novelNode: currentItem.novel_node,
          studentSentence,
          aiStrictness: cohortSettings?.ai_strictness || 'standard',
          isRetry,
          itemType: currentItem.item_type,
          incorrectSentence: currentItem.incorrect_sentence,
          errorTarget: currentItem.error_target
        })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Calculate final XP with hint penalty
        let finalXp = result.xpAwarded;
        if (hintUsed) {
          finalXp = Math.max(0, finalXp - 10);
        }
        
        // Update result with final XP for display
        const finalResult = { ...result, xpAwarded: finalXp };
        
        setBossFeedback(finalResult);
        setSessionXp(prev => prev + finalXp);
        
        // Log the review as a 4 if correct, 1 if incorrect for SM2 progression
        // If it's a retry and they got it correct, we still log it as a success but maybe with a slightly lower quality score internally if we wanted to be strict, but for now 4 is fine.
        const quality = result.isCorrect ? 4 : 1;
        const responseTimeMs = Date.now() - startTime;
        
        const prevProgress = currentItem.progress || {
          repetitions: 0,
          easeFactor: 2.5,
          interval: 0
        };

        const sm2Result = calculateSM2(
          quality,
          prevProgress.repetitions,
          prevProgress.easeFactor,
          prevProgress.interval
        );

        await fetch('/api/study/log-review', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': token || ''
          },
          body: JSON.stringify({
            itemId: currentItem.id,
            score: quality,
            responseTimeMs,
            sm2Result: {
              repetitions: sm2Result.repetitions,
              easeFactor: sm2Result.easeFactor,
              interval: sm2Result.interval,
              nextReviewDate: sm2Result.nextReviewDate.toISOString()
            }
          })
        });
      } else {
        alert("Failed to evaluate sentence.");
      }
    } catch (error) {
      console.error("Error submitting strike:", error);
      alert("An error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinueFromBoss = () => {
    setSlideDirection('out');
    setTimeout(() => {
      if (currentIndex + 1 < items.length) {
        setCurrentIndex(prev => prev + 1);
        setShowAnswer(false);
        setStartTime(Date.now());
        setSlideDirection('in');
        setBossFeedback(null);
        setStudentSentence('');
        setIsRetry(false);
        setHintUsed(false);
        
        const nextItem = items[currentIndex + 1];
        const encounterChance = (cohortSettings?.boss_encounter_rate || 15) / 100;
        const isBossEncounter = nextItem.item_type === 'vocab' && (Math.random() < encounterChance || (nextItem.progress?.easeFactor > 2.5));
        setSessionState(isBossEncounter ? 'boss' : 'active');
      } else {
        setSessionState('victory');
        fetchUserData();
      }
    }, 300);
  };

  const handleReturnToHub = () => {
    setSessionState('hub');
    fetchItems();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-6 max-w-md text-center">
          <ShieldAlert className="w-10 h-10 text-red-400 mx-auto mb-4" />
          <p className="text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 md:p-8 relative overflow-hidden">
      {showCohortModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-indigo-500 rounded-xl p-8 shadow-2xl max-w-lg w-full text-center space-y-8 animate-in zoom-in-95 duration-300">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-white tracking-tight">Welcome to the Arena</h2>
              <p className="text-slate-400">Enter your 6-digit Class Code to begin.</p>
            </div>
            
            <div className="flex flex-col gap-4">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Ex: X9Y2Z1"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-6 py-4 text-center text-2xl font-mono font-bold text-white tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none uppercase placeholder:text-slate-600"
                maxLength={6}
              />
              
              <button
                onClick={handleJoinClass}
                disabled={isSettingCohort || joinCode.length < 6}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSettingCohort ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                Join Class
              </button>
            </div>
            
            <p className="text-xs text-slate-500 uppercase tracking-widest">
              Ask your teacher for the code
            </p>
          </div>
        </div>
      )}

      {showLevelUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-500">
          <div className={`relative max-w-md w-full p-8 rounded-3xl text-center border-2 shadow-[0_0_50px_rgba(0,0,0,0.5)] transform animate-in zoom-in-95 duration-500 ${
            newRank === 'Silver' ? 'bg-slate-800 border-slate-400 shadow-[0_0_30px_rgba(148,163,184,0.3)]' :
            newRank === 'Gold' ? 'bg-slate-900 border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.3)]' :
            newRank === 'Platinum' ? 'bg-slate-900 border-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.3)]' :
            'bg-slate-800 border-indigo-500'
          }`}>
            <div className="absolute -top-12 left-1/2 -translate-x-1/2">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 shadow-xl ${
                newRank === 'Silver' ? 'bg-slate-200 border-slate-400 text-slate-600' :
                newRank === 'Gold' ? 'bg-yellow-100 border-yellow-500 text-yellow-600' :
                newRank === 'Platinum' ? 'bg-cyan-100 border-cyan-400 text-cyan-600' :
                'bg-indigo-100 border-indigo-500 text-indigo-600'
              }`}>
                <Trophy className="w-12 h-12" />
              </div>
            </div>
            
            <div className="mt-10 space-y-4">
              <h2 className={`text-4xl font-black uppercase tracking-tighter ${
                newRank === 'Silver' ? 'text-slate-200' :
                newRank === 'Gold' ? 'text-yellow-400' :
                newRank === 'Platinum' ? 'text-cyan-400' :
                'text-white'
              }`}>
                Rank Up!
              </h2>
              <p className="text-lg text-slate-400 font-medium">
                You've reached <span className="text-white font-bold">{newRank}</span> Rank.
              </p>
              <div className="pt-6">
                <button 
                  onClick={() => setShowLevelUpModal(false)}
                  className={`w-full py-3 px-6 rounded-xl font-bold text-lg transition-all transform hover:scale-105 ${
                    newRank === 'Silver' ? 'bg-slate-200 text-slate-900 hover:bg-white' :
                    newRank === 'Gold' ? 'bg-yellow-500 text-yellow-950 hover:bg-yellow-400' :
                    newRank === 'Platinum' ? 'bg-cyan-500 text-cyan-950 hover:bg-cyan-400' :
                    'bg-indigo-600 text-white hover:bg-indigo-500'
                  }`}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionState === 'hub' && (
        <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-500">
          <header className="mb-12 text-center">
            <h1 className="text-4xl font-black mb-4 tracking-tight">Player Hub</h1>
            <p className="text-slate-400 text-lg">Master your vocabulary and grammar through spaced retrieval.</p>
          </header>

          <div className="space-y-8">
            {/* Player Card */}
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 shadow-xl shrink-0 ${
                  userData?.rank === 'Silver' ? 'bg-slate-200 border-slate-400 text-slate-600' :
                  userData?.rank === 'Gold' ? 'bg-yellow-100 border-yellow-500 text-yellow-600' :
                  userData?.rank === 'Platinum' ? 'bg-cyan-100 border-cyan-400 text-cyan-600' :
                  'bg-indigo-100 border-indigo-500 text-indigo-600'
                }`}>
                  <Trophy className="w-10 h-10" />
                </div>
                <div className="flex-1 text-center md:text-left">
                  <h2 className="text-3xl font-bold text-white mb-2">{userData?.name || 'Student'}</h2>
                  <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${
                      userData?.rank === 'Silver' ? 'bg-slate-400/20 text-slate-300 border border-slate-400/30' :
                      userData?.rank === 'Gold' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                      userData?.rank === 'Platinum' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                      'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    }`}>
                      {userData?.rank || 'Bronze'} Rank
                    </span>
                    <span className="text-slate-400 font-mono text-sm">{userData?.xp || 0} XP</span>
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-3 border border-slate-700 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(100, ((userData?.xp || 0) % 1000) / 10)}%` }}
                    ></div>
                  </div>
                  <p className="text-right text-xs text-slate-500 mt-2 font-mono">Next rank at {Math.ceil(((userData?.xp || 0) + 1) / 1000) * 1000} XP</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid gap-6">
              {items.length > 0 ? (
                <button 
                  onClick={handleStartSession}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black text-2xl py-8 px-8 rounded-3xl shadow-[0_0_30px_rgba(79,70,229,0.4)] hover:shadow-[0_0_50px_rgba(79,70,229,0.6)] transition-all transform hover:scale-[1.02] flex flex-col items-center justify-center gap-2 group"
                >
                  <span className="flex items-center gap-3">
                    <Swords className="w-8 h-8 group-hover:rotate-12 transition-transform" />
                    Start Daily Review
                  </span>
                  <span className="text-indigo-200 text-sm font-medium uppercase tracking-widest bg-indigo-900/50 px-4 py-1 rounded-full">
                    {items.length} Due Today
                  </span>
                </button>
              ) : (
                <div className="w-full bg-slate-800 border border-slate-700 text-slate-300 font-bold text-xl py-8 px-8 rounded-3xl flex flex-col items-center justify-center gap-4 text-center">
                  <CheckCircle className="w-12 h-12 text-emerald-500/50" />
                  <div>
                    <p className="text-white">You're All Caught Up!</p>
                    <p className="text-sm text-slate-500 font-normal mt-1">No items are due for review right now.</p>
                  </div>
                </div>
              )}

              <button 
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-lg py-6 px-8 rounded-3xl transition-all flex items-center justify-center gap-3"
                onClick={() => alert("Endless Practice Mode coming soon!")}
              >
                <Sparkles className="w-5 h-5 text-slate-400" />
                Endless Practice Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionState === 'active' && currentItem && (
        <div className="max-w-3xl mx-auto h-full flex flex-col">
          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex justify-between text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">
              <span>Card {currentIndex + 1} of {items.length}</span>
              <span className="text-indigo-400">{sessionXp} XP</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-indigo-500 h-full transition-all duration-300"
                style={{ width: `${((currentIndex) / items.length) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Flashcard */}
          <div 
            key={currentItem.id}
            className={`flex-1 flex items-center justify-center ${
            slideDirection === 'in' ? 'animate-slide-in-right' : 'transition-all duration-300 transform -translate-x-full opacity-0'
          }`}>
            <div className={`perspective-1000 w-full max-w-2xl mx-auto transition-transform duration-500 ease-[cubic-bezier(0.68,-0.55,0.265,1.55)] ${isFlipping ? 'scale-105' : 'scale-100'}`}>
              <div className={`relative w-full transition-all duration-500 ease-[cubic-bezier(0.68,-0.55,0.265,1.55)] [transform-style:preserve-3d] ${showAnswer ? 'rotate-y-180' : ''} ${isFlipping ? 'shadow-2xl' : 'shadow-xl'}`}>
                
                {/* Front */}
                <div className={`absolute inset-0 w-full h-full backface-hidden bg-slate-800 rounded-3xl border border-slate-700 p-8 md:p-12 flex flex-col items-center justify-center ${showAnswer ? 'pointer-events-none' : ''}`}>
                  <div className="absolute top-6 right-6">
                    <span className={`text-xs uppercase tracking-widest font-bold px-3 py-1 rounded-full ${currentItem.item_type === 'vocab' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {currentItem.item_type}
                    </span>
                  </div>

                  <div className="text-center space-y-10 w-full">
                    <div className="space-y-6">
                      <h2 className="text-sm text-slate-400 uppercase tracking-widest font-bold">
                        {currentQuestion?.type === 'grammar' ? 'Spot the Bug' : currentQuestion?.type?.replace('_', ' ')}
                      </h2>
                      <div className="flex items-center justify-center gap-4">
                        <p className="text-3xl md:text-4xl font-medium leading-relaxed italic text-white">
                          {currentQuestion?.prompt_text}
                        </p>
                        <button 
                          onClick={() => handleSpeak(currentQuestion?.prompt_text || '')}
                          className="p-3 bg-slate-700 hover:bg-slate-600 rounded-full transition-colors text-slate-300 hover:text-white shrink-0"
                          title="Listen"
                        >
                          <Volume2 className="w-6 h-6" />
                        </button>
                      </div>
                    </div>

                    <button 
                      onClick={handleReveal}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xl py-5 px-10 rounded-2xl shadow-lg transition-all transform hover:scale-105 w-full md:w-auto"
                    >
                      {currentQuestion?.type === 'grammar' ? 'Reveal Bug' : 'Reveal Answer'}
                    </button>
                  </div>
                </div>

                {/* Back */}
                <div className={`relative w-full backface-hidden rotate-y-180 bg-gradient-to-br from-violet-900 via-purple-900 to-fuchsia-900 rounded-3xl border border-fuchsia-500/50 p-8 md:p-12 flex flex-col items-center justify-center ${!showAnswer ? 'pointer-events-none' : ''}`}>
                  <div className="absolute top-6 right-6">
                    <span className={`text-xs uppercase tracking-widest font-bold px-3 py-1 rounded-full bg-white/20 text-white`}>
                      {currentItem.item_type}
                    </span>
                  </div>

                  <div className="w-full space-y-10">
                    <div className="p-8 bg-black/20 rounded-2xl border border-white/20">
                      {currentItem.item_type === 'grammar' ? (
                        <div className="space-y-6 text-left">
                          <div>
                            <span className="text-xs font-bold text-white/80 uppercase tracking-widest block mb-2">Error Target</span>
                            <p className="text-xl text-white bg-white/10 p-3 rounded-lg border border-white/20 inline-block">
                              {currentItem.error_target}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white/80 uppercase tracking-widest block mb-2">Corrected Sentence</span>
                            <div className="flex items-start gap-3">
                              <p className="text-2xl text-white leading-relaxed">
                                {currentItem.corrected_sentence}
                              </p>
                              <button 
                                onClick={() => handleSpeak(currentItem.corrected_sentence)}
                                className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white shrink-0 mt-1"
                                title="Listen"
                              >
                                <Volume2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 text-center">
                          <div className="flex items-center justify-center gap-4 mb-4">
                            <h3 className="text-4xl md:text-5xl font-black text-white tracking-tight">{currentItem.term}</h3>
                            <button 
                              onClick={() => handleSpeak(currentItem.term)}
                              className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
                              title="Listen"
                            >
                              <Volume2 className="w-6 h-6" />
                            </button>
                          </div>
                          <p className="text-lg text-white">{currentItem.definition}</p>
                          <div className="flex items-center justify-center gap-3 mt-6 pt-6 border-t border-white/20">
                            <p className="text-sm text-white italic">Answer: {currentQuestion?.answer_text}</p>
                            <button 
                              onClick={() => handleSpeak(currentQuestion?.answer_text || '')}
                              className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white shrink-0"
                              title="Listen"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-6 text-center">
                      <p className="text-base text-white font-bold uppercase tracking-widest">How well did you know this?</p>
                      <div className="grid grid-cols-6 gap-3">
                        {[0, 1, 2, 3, 4, 5].map((q) => (
                          <button
                            key={q}
                            disabled={isSubmitting}
                            onClick={() => handleRating(q)}
                            className={`py-4 rounded-xl font-black text-xl transition-all transform hover:scale-105 ${
                              q < 3 
                                ? 'bg-red-500/20 text-white hover:bg-red-500 border border-red-500/30 hover:border-red-500' 
                                : 'bg-emerald-500/20 text-white hover:bg-emerald-500 border border-emerald-500/30 hover:border-emerald-500'
                            } disabled:opacity-50 disabled:hover:scale-100`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs font-bold text-white/80 uppercase tracking-widest px-2">
                        <span>Forgot</span>
                        <span>Perfect</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionState === 'boss' && currentItem && (
        <div className="max-w-3xl mx-auto h-full flex flex-col">
          <div className="mb-8">
            <div className="flex justify-between text-sm font-bold text-slate-400 mb-2 uppercase tracking-widest">
              <span className="text-red-500 animate-pulse">Boss Encounter</span>
              <span className="text-indigo-400">{sessionXp} XP</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-red-500/30">
              <div 
                className="bg-red-500 h-full transition-all duration-300"
                style={{ width: `${((currentIndex) / items.length) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className={`flex-1 flex items-center justify-center ${slideDirection === 'in' ? 'animate-slide-in-right' : 'transition-all duration-300 transform -translate-x-full opacity-0'}`}>
            <div className="w-full max-w-2xl mx-auto bg-slate-950 rounded-3xl border-2 border-red-500 p-8 md:p-12 shadow-[0_0_30px_rgba(239,68,68,0.4)] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              
              <div className="relative z-10 w-full text-center space-y-8">
                <div className="space-y-4">
                  <ShieldAlert className="w-16 h-16 text-red-500 mx-auto animate-pulse" />
                  <h2 className="text-5xl md:text-6xl font-black text-white tracking-tight uppercase drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]">
                    {currentItem.term}
                  </h2>
                  <p className="text-red-400 font-bold uppercase tracking-widest text-sm">Application Challenge</p>
                </div>

                {!bossFeedback ? (
                  <div className="space-y-6 w-full text-left">
                    <div className="bg-slate-900/80 p-6 rounded-xl border border-red-500/30">
                      {currentItem.item_type === 'grammar' ? (
                        <>
                          <label className="block text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">
                            Identify and fix the grammatical error in this sentence.
                          </label>
                          <div className="bg-red-500/10 border-l-4 border-red-500 p-4 mb-6 rounded-r-lg">
                            <p className="text-white font-medium italic text-lg">"{currentItem.incorrect_sentence}"</p>
                          </div>
                          
                          {!hintUsed && (
                            <button 
                              onClick={() => setHintUsed(true)}
                              className="text-xs font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-widest mb-4 flex items-center gap-2 transition-colors"
                            >
                              <Sparkles className="w-4 h-4" />
                              Use Hint (-10 XP)
                            </button>
                          )}
                          
                          {hintUsed && (
                            <div className="bg-indigo-500/10 border border-indigo-500/30 p-3 rounded-lg mb-4 animate-in fade-in slide-in-from-top-2">
                              <p className="text-indigo-300 text-sm font-medium">
                                <span className="font-bold uppercase tracking-wider mr-2">Hint:</span> 
                                Look for {currentItem.error_target}
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <label className="block text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">
                          Write an original sentence using this word.
                          {currentItem.novel_node && <span className="block mt-1 text-xs text-slate-500 normal-case italic">Context: {currentItem.novel_node}</span>}
                        </label>
                      )}
                      <textarea
                        value={studentSentence}
                        onChange={(e) => setStudentSentence(e.target.value)}
                        placeholder={currentItem.item_type === 'grammar' ? "Type the corrected sentence here..." : "Type your sentence here..."}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none resize-none h-32"
                      />
                    </div>
                    <button
                      onClick={handleSubmitStrike}
                      disabled={isSubmitting || !studentSentence.trim()}
                      className="w-full bg-red-600 hover:bg-red-500 text-white font-black text-xl py-5 px-8 rounded-xl shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-3"
                    >
                      {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Swords className="w-6 h-6" />}
                      Submit Strike
                    </button>
                  </div>
                ) : (
                  <div className="space-y-6 w-full animate-in fade-in zoom-in-95 duration-500">
                    <div className={`p-6 rounded-xl border-2 ${bossFeedback.isCorrect ? 'bg-emerald-900/30 border-emerald-500' : 'bg-red-900/30 border-red-500'}`}>
                      <div className="flex items-center justify-center gap-3 mb-4">
                        {bossFeedback.isCorrect ? <CheckCircle className="w-8 h-8 text-emerald-400" /> : <ShieldAlert className="w-8 h-8 text-red-400" />}
                        <h3 className={`text-2xl font-black uppercase ${bossFeedback.isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                          {bossFeedback.isCorrect ? 'Critical Hit!' : 'Missed!'}
                        </h3>
                      </div>
                      
                      <p className="text-lg font-bold text-white mb-4">{bossFeedback.feedback}</p>
                      
                      {bossFeedback.detailedAnalysis && (
                        <div className="bg-slate-950/50 p-4 rounded-lg text-sm text-slate-300 mb-4 text-left border border-white/5">
                          <p className="font-bold text-slate-400 uppercase text-xs mb-2 tracking-widest">Analysis</p>
                          <p className="leading-relaxed">{bossFeedback.detailedAnalysis}</p>
                        </div>
                      )}

                      {bossFeedback.correction && (
                         <div className="bg-slate-950/50 p-4 rounded-lg text-sm text-slate-300 mb-4 text-left border border-white/5">
                          <p className="font-bold text-slate-400 uppercase text-xs mb-2 tracking-widest">
                            {bossFeedback.isCorrect ? 'Sophisticated Variation' : 'Correction'}
                          </p>
                          <p className="italic text-indigo-300 font-medium">"{bossFeedback.correction}"</p>
                        </div>
                      )}

                      <div className="inline-block bg-slate-950 px-4 py-2 rounded-lg border border-slate-800 mt-2">
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-widest mr-2">XP Awarded:</span>
                        <span className={`text-xl font-black ${bossFeedback.isCorrect ? 'text-emerald-400' : 'text-slate-300'}`}>+{bossFeedback.xpAwarded}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      {!bossFeedback.isCorrect && (
                        <button
                          onClick={() => {
                            setBossFeedback(null);
                            setIsRetry(true);
                          }}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xl py-5 px-8 rounded-xl shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all transform hover:scale-105 flex items-center justify-center gap-3"
                        >
                          <Edit3 className="w-6 h-6" />
                          Try Again (Rewrite for +25 XP)
                        </button>
                      )}
                      <button
                        onClick={handleContinueFromBoss}
                        className={`w-full font-bold text-xl py-5 px-8 rounded-xl border transition-all ${!bossFeedback.isCorrect ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600' : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]'}`}
                      >
                        {bossFeedback.isCorrect ? 'Continue' : 'Accept Defeat (Continue)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {sessionState === 'victory' && (
        <div className="max-w-2xl mx-auto text-center animate-in zoom-in-95 duration-700 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-32 h-32 bg-emerald-500/20 rounded-full flex items-center justify-center mb-8 border-4 border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.3)]">
            <Trophy className="w-16 h-16 text-emerald-400" />
          </div>
          <h1 className="text-5xl font-black text-white mb-4 tracking-tight">Session Complete!</h1>
          <p className="text-xl text-slate-400 mb-12">You've mastered your daily queue.</p>
          
          <div className="bg-slate-800 border border-slate-700 rounded-3xl p-8 w-full max-w-md mb-12 shadow-xl">
            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-2">Total XP Earned</p>
            <p className="text-6xl font-black text-indigo-400">+{sessionXp}</p>
          </div>

          <button 
            onClick={handleReturnToHub}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xl py-4 px-12 rounded-full shadow-lg transition-all transform hover:scale-105"
          >
            Return to Hub
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const [viewMode, setViewMode] = useState<'deploy' | 'analytics' | 'bottlenecks'>('deploy');
  const [activeTab, setActiveTab] = useState<'content' | 'classes' | 'activity'>('content');
  const [roster, setRoster] = useState<any[]>([]);
  const [bottlenecks, setBottlenecks] = useState<any[]>([]);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [isLoadingBottlenecks, setIsLoadingBottlenecks] = useState(false);
  const [term, setTerm] = useState('');
  const [itemType, setItemType] = useState('vocab');
  const [cohortId, setCohortId] = useState('');
  const [targetClasses, setTargetClasses] = useState<string[]>([]);
  const [novelNode, setNovelNode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [recentItems, setRecentItems] = useState<LearningItem[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);
  const [newCohortName, setNewCohortName] = useState('');
  const [newCohortColor, setNewCohortColor] = useState('indigo');
  const [showArchived, setShowArchived] = useState(false);
  const [isCreatingCohort, setIsCreatingCohort] = useState(false);
  const [entryMode, setEntryMode] = useState<'ai' | 'manual'>('ai');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterNovel, setFilterNovel] = useState('');
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const [editTerm, setEditTerm] = useState('');
  const [editDefinition, setEditDefinition] = useState('');
  const [showClassSettingsModal, setShowClassSettingsModal] = useState(false);
  const [editingClass, setEditingClass] = useState<Cohort | null>(null);
  const [encounterRate, setEncounterRate] = useState(15);
  const [aiStrictness, setAiStrictness] = useState('standard');

  const handleSaveSettings = async () => {
    if (!editingClass) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/classes/${editingClass.id}/settings`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'x-auth-token': token || '' 
        },
        body: JSON.stringify({ 
          boss_encounter_rate: encounterRate, 
          ai_strictness: aiStrictness 
        })
      });
      
      if (response.ok) {
        setCohorts(prev => prev.map(c => 
          c.id === editingClass.id 
            ? { ...c, boss_encounter_rate: encounterRate, ai_strictness: aiStrictness as any } 
            : c
        ));
        setShowClassSettingsModal(false);
        showToast('Class settings updated successfully!');
      } else {
        showToast('Failed to update settings.', 'error');
      }
    } catch (e) {
      showToast('Error saving settings.', 'error');
    }
  };

  // Roster Drill-Down state
  const [selectedClassDetails, setSelectedClassDetails] = useState<Cohort | null>(null);
  const [classRoster, setClassRoster] = useState<any[]>([]);
  const [isLoadingClassRoster, setIsLoadingClassRoster] = useState(false);
  const [movingStudent, setMovingStudent] = useState<any>(null);
  const [removingStudent, setRemovingStudent] = useState<any>(null);
  const [newCohortForStudent, setNewCohortForStudent] = useState('');

  // Manual entry fields
  const [manualDefinition, setManualDefinition] = useState('');
  const [manualPOS, setManualPOS] = useState('');
  const [manualExample, setManualExample] = useState('');
  const [manualFillBlank, setManualFillBlank] = useState('');

  useEffect(() => {
    fetchCohorts();
    fetchRecent();
  }, []);

  const fetchClassRoster = async (cohortId: string) => {
    setIsLoadingClassRoster(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/roster/${cohortId}`, {
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        const data = await response.json();
        setClassRoster(data);
      }
    } catch (e) {
      console.error("Error fetching class roster:", e);
    } finally {
      setIsLoadingClassRoster(false);
    }
  };

  const handleMoveStudent = async () => {
    if (!movingStudent || !newCohortForStudent) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/student/${movingStudent.id}/move`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'x-auth-token': token || '' 
        },
        body: JSON.stringify({ newCohortId: newCohortForStudent })
      });
      if (response.ok) {
        setMovingStudent(null);
        setNewCohortForStudent('');
        if (selectedClassDetails) {
          fetchClassRoster(selectedClassDetails.id);
        }
        showToast('Student moved successfully', 'success');
      }
    } catch (e) {
      console.error("Error moving student:", e);
      showToast('Failed to move student', 'error');
    }
  };

  const handleRemoveStudent = async () => {
    if (!removingStudent) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/student/${removingStudent.id}/remove`, {
        method: 'DELETE',
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        setRemovingStudent(null);
        if (selectedClassDetails) {
          fetchClassRoster(selectedClassDetails.id);
        }
        showToast('Student removed successfully', 'success');
      }
    } catch (e) {
      console.error("Error removing student:", e);
      showToast('Failed to remove student', 'error');
    }
  };

  const fetchRecent = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/word-bank', {
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        const data = await response.json();
        setRecentItems(data);
      }
    } catch (e) {
      console.error("Error fetching recent items:", e);
    }
  };

  const fetchRoster = async () => {
    setIsLoadingRoster(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/roster', {
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        const data = await response.json();
        setRoster(data);
      }
    } catch (e) {
      console.error("Error fetching roster:", e);
    } finally {
      setIsLoadingRoster(false);
    }
  };

  const fetchBottlenecks = async (selectedCohortId: string) => {
    if (!selectedCohortId) return;
    setIsLoadingBottlenecks(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/bottlenecks/${selectedCohortId}`, {
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        const data = await response.json();
        setBottlenecks(data);
      }
    } catch (e) {
      console.error("Error fetching bottlenecks:", e);
    } finally {
      setIsLoadingBottlenecks(false);
    }
  };

  const fetchCohorts = async () => {
    if (!db) return;
    try {
      // Fetch from 'classes' collection
      const q = query(collection(db, 'classes'), where('is_archived', '==', showArchived));
      const querySnapshot = await getDocs(q);
      const fetchedCohorts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cohort));
      // Sort by name client-side to avoid index requirement
      fetchedCohorts.sort((a, b) => a.name.localeCompare(b.name));
      setCohorts(fetchedCohorts);
      if (fetchedCohorts.length > 0 && !cohortId) {
        setCohortId(fetchedCohorts[0].name);
      }
    } catch (e) {
      console.error("Error fetching classes:", e);
    }
  };

  useEffect(() => {
    fetchCohorts();
  }, [showArchived]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreateCohort = async () => {
    if (!newCohortName.trim() || !db) return;
    setIsCreatingCohort(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || ''
        },
        body: JSON.stringify({ 
          name: newCohortName.trim(),
          theme_color: newCohortColor 
        })
      });
      
      if (response.ok) {
        setNewCohortName('');
        setNewCohortColor('indigo');
        await fetchCohorts();
        showToast('Class created successfully!');
      } else {
        showToast('Failed to create class.', 'error');
      }
    } catch (e) {
      showToast('Failed to create class.', 'error');
    } finally {
      setIsCreatingCohort(false);
    }
  };

  const handleArchiveCohort = async (id: string) => {
    if (!window.confirm('Are you sure you want to archive this class?')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/classes/${id}/archive`, {
        method: 'PATCH',
        headers: { 'x-auth-token': token || '' }
      });
      if (response.ok) {
        await fetchCohorts();
        showToast('Class archived successfully!');
      }
    } catch (e) {
      showToast('Failed to archive class.', 'error');
    }
  };

  const handleDeleteCohort = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this class? This action cannot be undone.')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/classes/${id}`, {
        method: 'DELETE',
        headers: { 'x-auth-token': token || '' }
      });

      if (response.ok) {
        await fetchCohorts();
        showToast('Class deleted successfully!');
      } else {
        throw new Error('Failed to delete class');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to delete class.', 'error');
    }
  };

  const handleDeleteContent = async (id: string) => {
    if (!db || !window.confirm('Are you sure you want to delete this learning item?')) return;
    try {
      await deleteDoc(doc(db, 'learning_items', id));
      await fetchRecent();
      showToast('Content deleted successfully!');
    } catch (e) {
      console.error(e);
      showToast('Failed to delete content.', 'error');
    }
  };

  const handleEditContent = (item: any) => {
    setTerm(item.term);
    setItemType(item.item_type);
    setTargetClasses(item.target_classes || (item.cohort_id ? [item.cohort_id] : []));
    setNovelNode(item.novel_node || '');
    setEntryMode('manual');
    setManualDefinition(item.definition || '');
    setManualPOS(item.part_of_speech || '');
    
    if (item.question_bank && item.question_bank.length > 0) {
      setManualExample(item.question_bank[0].answer_text || '');
      setManualFillBlank(item.question_bank[0].prompt_text || '');
    } else {
      setManualExample(item.example_sentence || '');
      setManualFillBlank(item.fill_in_the_blank || '');
    }
    
    setActiveTab('content');
    showToast('Content loaded into editor.');
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/edit-item/${editingItem.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || ''
        },
        body: JSON.stringify({ term: editTerm, definition: editDefinition })
      });
      if (response.ok) {
        showToast('Content updated successfully!');
        setEditingItem(null);
        fetchRecent();
      } else {
        showToast('Failed to update content.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Failed to update content.', 'error');
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/toggle-status/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || ''
        },
        body: JSON.stringify({ is_active: !currentStatus })
      });

      if (!response.ok) {
        throw new Error('Failed to toggle status');
      }

      await fetchRecent();
      showToast(`Content ${!currentStatus ? 'activated' : 'retired'} successfully!`);
    } catch (e) {
      console.error(e);
      showToast('Failed to toggle content status.', 'error');
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratedContent(null);
    
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured.');
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = `
        Generate a high-school level ${itemType} learning item for the term "${term}".
        Context/Novel: ${novelNode || 'General Academic'}.
        
        Return strictly valid JSON with the following schema:
        {
          "definition": "Clear, academic definition",
          "part_of_speech": "e.g. Noun, Verb",
          "question_bank": [
            {
              "type": "cloze",
              "prompt_text": "A fill-in-the-blank sentence tied to the Context/Novel. Replace the term with underscores (_____).",
              "answer_text": "The full sentence with the term included."
            },
            {
              "type": "application",
              "prompt_text": "A conceptual question (e.g., 'Which character\\'s action in [Novel Node] best demonstrates [Term]?').",
              "answer_text": "The answer to the conceptual question."
            },
            {
              "type": "synonym_context",
              "prompt_text": "A sentence using a synonym, asking the student to identify the target vocabulary word that could replace it.",
              "answer_text": "The target vocabulary word."
            }
          ],
          "incorrect_sentence": "${itemType === 'grammar' ? 'A sentence containing the specific grammar error.' : ''}",
          "error_target": "${itemType === 'grammar' ? 'The specific part of the incorrect sentence that is wrong.' : ''}",
          "corrected_sentence": "${itemType === 'grammar' ? 'The corrected version of the sentence.' : ''}"
        }
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const generatedContent = JSON.parse(text);
      setGeneratedContent(generatedContent);
    } catch (error: any) {
      console.error('AI Generation Error:', error);
      showToast(error.message || 'Failed to generate content.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeploy = async () => {
    const contentToSave = entryMode === 'ai' ? generatedContent : {
      definition: manualDefinition,
      part_of_speech: manualPOS,
      question_bank: [
        {
          type: 'cloze',
          prompt_text: manualFillBlank || manualExample.replace(new RegExp(term, 'gi'), '_____'),
          answer_text: manualExample
        }
      ]
    };

    if (!contentToSave || !term || !db || targetClasses.length === 0) {
      showToast('Please fill in all required fields and select at least one class.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'learning_items'), {
        term,
        item_type: itemType,
        target_classes: targetClasses,
        novel_node: novelNode,
        is_active: true,
        ...contentToSave,
        created_at: new Date().toISOString()
      });
      
      showToast('Content successfully deployed!');
      setTerm('');
      setGeneratedContent(null);
      setManualDefinition('');
      setManualPOS('');
      setManualExample('');
      setManualFillBlank('');
      setTargetClasses([]);
      await fetchRecent();
    } catch (error) {
      console.error(error);
      showToast('Failed to save content.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const exportToCSV = () => {
    if (roster.length === 0) return;

    const headers = ['Student Name', 'Email', 'Rank', 'Total XP', 'Mastered Words', 'Decaying Words'];
    const csvContent = [
      headers.join(','),
      ...roster.map(student => [
        `"${student.name}"`,
        `"${student.email}"`,
        student.rank,
        student.xp,
        student.masteredItems,
        student.decayingMastery
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'vocab_arena_export.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Teacher Dashboard</h1>
            <p className="text-slate-400">Manage classes and monitor student performance.</p>
          </div>
          
          <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
            <button 
              onClick={() => setViewMode('deploy')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'deploy' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Deploy Content
            </button>
            <button 
              onClick={() => {
                setViewMode('analytics');
                fetchRoster();
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'analytics' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              <Users className="w-4 h-4" />
              Student Heatmap
            </button>
            <button 
              onClick={() => {
                setViewMode('bottlenecks');
                if (cohortId) {
                  fetchBottlenecks(cohortId);
                }
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'bottlenecks' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              <ShieldAlert className="w-4 h-4" />
              Content Bottlenecks
            </button>
          </div>
        </header>

        {viewMode === 'deploy' && (
          <div className="flex mb-8 bg-slate-800/50 p-1 rounded-lg border border-slate-700 w-fit">
            <button 
              onClick={() => setActiveTab('content')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'content' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Plus className="w-3 h-3" />
              Add Content
            </button>
            <button 
              onClick={() => setActiveTab('classes')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'classes' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <UsersRound className="w-3 h-3" />
              Classes
            </button>
            <button 
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'activity' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <History className="w-3 h-3" />
              Word Bank
            </button>
          </div>
        )}

        {toast && (
          <div className={`fixed top-4 right-4 ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'} text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 z-[100]`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            {toast.message}
          </div>
        )}

        {viewMode === 'deploy' && activeTab === 'content' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Input Form */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-indigo-400" />
                    Deploy New Content
                  </h2>
                  <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700">
                    <button 
                      onClick={() => setEntryMode('ai')}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${entryMode === 'ai' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      AI Assist
                    </button>
                    <button 
                      onClick={() => setEntryMode('manual')}
                      className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${entryMode === 'manual' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      Manual
                    </button>
                  </div>
                </div>
                
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Term / Concept</label>
                      <input 
                        type="text" 
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="e.g. Juxtaposition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Target Classes</label>
                      <div className="flex flex-wrap gap-2">
                        {cohorts.length === 0 ? (
                          <span className="text-sm text-slate-500">No classes found</span>
                        ) : (
                          cohorts.map(c => (
                            <button
                              key={c.id}
                              onClick={() => {
                                setTargetClasses(prev => 
                                  prev.includes(c.name) 
                                    ? prev.filter(name => name !== c.name)
                                    : [...prev, c.name]
                                );
                              }}
                              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${
                                targetClasses.includes(c.name) 
                                  ? 'bg-indigo-600 border-indigo-500 text-white' 
                                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {c.name}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Content Type</label>
                      <div className="flex gap-2">
                        {['vocab', 'grammar'].map(type => (
                          <button
                            key={type}
                            onClick={() => setItemType(type)}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${itemType === type ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400' : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-600'}`}
                          >
                            {type === 'vocab' ? 'Vocabulary' : 'Grammar'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Novel / Context (Optional)</label>
                      <input 
                        type="text" 
                        value={novelNode}
                        onChange={(e) => setNovelNode(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="e.g. To Kill a Mockingbird"
                      />
                    </div>
                  </div>

                  {entryMode === 'manual' && (
                    <div className="space-y-4 pt-4 border-t border-slate-700 animate-in fade-in duration-300">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Definition</label>
                          <textarea 
                            value={manualDefinition}
                            onChange={(e) => setManualDefinition(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Part of Speech</label>
                          <input 
                            type="text" 
                            value={manualPOS}
                            onChange={(e) => setManualPOS(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="e.g. Noun"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Example Sentence</label>
                        <textarea 
                          value={manualExample}
                          onChange={(e) => setManualExample(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none h-20 resize-none"
                          placeholder="Use the term in a sentence..."
                        />
                      </div>
                    </div>
                  )}

                  {entryMode === 'ai' ? (
                    <button 
                      onClick={handleGenerate}
                      disabled={isGenerating || !term}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5 group-hover:rotate-12 transition-transform" />}
                      Generate with AI
                    </button>
                  ) : (
                    <button 
                      onClick={handleDeploy}
                      disabled={isSaving || !term || !manualDefinition}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                      Deploy Content
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Preview / Side Panel */}
            <div className="space-y-6">
              {entryMode === 'ai' && (
                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl min-h-[300px] flex flex-col">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    AI Preview
                  </h3>
                  
                  {generatedContent ? (
                    <div className="flex-1 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                      <div className="p-4 bg-slate-900 rounded-xl border border-indigo-500/20">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase block mb-1">Definition</span>
                        <p className="text-sm text-slate-200 leading-relaxed">{generatedContent.definition}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-700">
                          <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">POS</span>
                          <p className="text-sm text-slate-200">{generatedContent.part_of_speech}</p>
                        </div>
                        <div className="p-3 bg-slate-900 rounded-xl border border-slate-700">
                          <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Type</span>
                          <p className="text-sm text-slate-200 uppercase">{itemType}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {generatedContent.question_bank?.map((q: any, idx: number) => (
                          <div key={idx} className="p-4 bg-slate-900 rounded-xl border border-slate-700">
                            <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Question: {q.type}</span>
                            <p className="text-sm text-slate-300 italic mb-2">"{q.prompt_text}"</p>
                            <span className="text-[10px] font-bold text-emerald-500 uppercase block mb-1">Answer</span>
                            <p className="text-sm text-slate-200">{q.answer_text}</p>
                          </div>
                        ))}
                      </div>

                      <button 
                        onClick={handleDeploy}
                        disabled={isSaving}
                        className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                        Approve & Deploy
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-center">
                      <Sparkles className="w-12 h-12 mb-4 opacity-10" />
                      <p className="text-sm italic">Enter a term and click generate to see AI suggestions.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Quick Stats</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Total Items</p>
                    <p className="text-2xl font-bold text-white">{recentItems.length}</p>
                  </div>
                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Classes</p>
                    <p className="text-2xl font-bold text-white">{cohorts.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'deploy' && activeTab === 'classes' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {!selectedClassDetails ? (
              <div className="space-y-8">
                {/* Top Actions */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-6 bg-slate-800/50 p-8 rounded-3xl border border-slate-700/50 backdrop-blur-sm shadow-xl">
                  <div className="space-y-1">
                    <h2 className="text-xl font-black text-white flex items-center gap-3 tracking-tight">
                      <Users className="w-8 h-8 text-indigo-400" />
                      CLASS MANAGEMENT
                    </h2>
                    <p className="text-slate-400 font-medium">Deploy training modules and monitor student progress.</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex bg-slate-950 rounded-xl p-1.5 border border-slate-800 shadow-inner">
                      <button
                        onClick={() => setShowArchived(false)}
                        className={`px-6 py-2.5 rounded-lg text-sm font-black uppercase tracking-widest transition-all ${!showArchived ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)]' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        Active
                      </button>
                      <button
                        onClick={() => setShowArchived(true)}
                        className={`px-6 py-2.5 rounded-lg text-sm font-black uppercase tracking-widest transition-all ${showArchived ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        Archived
                      </button>
                    </div>
                    <button 
                      onClick={() => setShowCreateClassModal(true)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest py-4 px-8 rounded-2xl shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center gap-3 transform hover:scale-105 active:scale-95"
                    >
                      <Plus className="w-6 h-6" />
                      Create New Class
                    </button>
                  </div>
                </div>

                {/* Create Class Modal */}
                {showCreateClassModal && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-10 max-w-lg w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-300 relative">
                      <button 
                        onClick={() => setShowCreateClassModal(false)}
                        className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full"
                      >
                        <X className="w-6 h-6" />
                      </button>
                      
                      <div className="mb-8">
                        <h3 className="text-3xl font-black text-white tracking-tight uppercase">New Class Setup</h3>
                        <p className="text-slate-400 font-medium">Initialize a new learning cohort.</p>
                      </div>
                      
                      <div className="space-y-8">
                        <div className="space-y-3">
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Class Designation</label>
                          <input 
                            type="text" 
                            value={newCohortName}
                            onChange={(e) => setNewCohortName(e.target.value)}
                            className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl px-6 py-5 text-white text-xl font-bold focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-700"
                            placeholder="e.g. 10th Grade Honors"
                            autoFocus
                          />
                        </div>
                        
                        <div className="space-y-3">
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Theme Identity</label>
                          <div className="flex justify-between items-center bg-slate-950 p-4 rounded-2xl border-2 border-slate-800">
                            {['indigo', 'emerald', 'rose', 'amber', 'cyan'].map((color) => (
                              <button
                                key={color}
                                onClick={() => setNewCohortColor(color)}
                                className={`w-14 h-14 rounded-2xl border-4 transition-all transform hover:scale-110 flex items-center justify-center ${
                                  newCohortColor === color 
                                    ? 'border-white shadow-[0_0_20px_rgba(255,255,255,0.2)] scale-110' 
                                    : 'border-transparent opacity-40 hover:opacity-100'
                                }`}
                              >
                                <div className={`w-full h-full rounded-xl ${
                                  color === 'indigo' ? 'bg-indigo-500' : 
                                  color === 'emerald' ? 'bg-emerald-500' : 
                                  color === 'rose' ? 'bg-rose-500' : 
                                  color === 'amber' ? 'bg-amber-500' : 
                                  'bg-cyan-500'
                                } shadow-inner`}></div>
                              </button>
                            ))}
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            handleCreateCohort();
                            setShowCreateClassModal(false);
                          }}
                          disabled={isCreatingCohort || !newCohortName.trim()}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-[0.15em] py-6 rounded-2xl shadow-[0_0_30px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-4 transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                          {isCreatingCohort ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
                          Initialize Class
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Class Settings Modal */}
                {showClassSettingsModal && editingClass && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-10 max-w-lg w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in-95 duration-300 relative">
                      <button 
                        onClick={() => setShowClassSettingsModal(false)}
                        className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-full"
                      >
                        <X className="w-6 h-6" />
                      </button>
                      
                      <div className="mb-8">
                        <h3 className="text-3xl font-black text-white tracking-tight uppercase">Class Settings</h3>
                        <p className="text-slate-400 font-medium">Configure AI behavior for {editingClass.name}.</p>
                      </div>
                      
                      <div className="space-y-8">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Boss Encounter Rate</label>
                            <span className="text-indigo-400 font-bold">{encounterRate}% chance</span>
                          </div>
                          <input 
                            type="range" 
                            min="5" 
                            max="50" 
                            value={encounterRate}
                            onChange={(e) => setEncounterRate(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                          <p className="text-xs text-slate-500">Probability of a Boss Card appearing during practice sessions.</p>
                        </div>
                        
                        <div className="space-y-3">
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-[0.2em]">AI Strictness</label>
                          <div className="relative">
                            <select 
                              value={aiStrictness}
                              onChange={(e) => setAiStrictness(e.target.value)}
                              className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl px-6 py-4 text-white font-bold focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all appearance-none"
                            >
                              <option value="lenient">Lenient (Focus on basic meaning)</option>
                              <option value="standard">Standard (Focus on grammar & meaning)</option>
                              <option value="honors">Honors/AP (Focus on sophisticated syntax)</option>
                            </select>
                            <div className="absolute right-6 top-1/2 transform -translate-y-1/2 pointer-events-none text-slate-500">
                              <ArrowRightLeft className="w-5 h-5 rotate-90" />
                            </div>
                          </div>
                        </div>

                        <button 
                          onClick={handleSaveSettings}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-[0.15em] py-6 rounded-2xl shadow-[0_0_30px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-3 mt-4 transform hover:scale-[1.02] active:scale-[0.98]"
                        >
                          <Save className="w-6 h-6" />
                          Save Settings
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Class Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {cohorts.length === 0 ? (
                    <div className="col-span-full py-32 text-center bg-slate-800/30 rounded-[2.5rem] border-4 border-dashed border-slate-800/50">
                      <div className="w-24 h-24 bg-slate-800 rounded-3xl flex items-center justify-center mx-auto mb-8 border-2 border-slate-700 shadow-xl">
                        <UsersRound className="w-12 h-12 text-slate-600" />
                      </div>
                      <h3 className="text-lg font-black text-white mb-3 tracking-tight uppercase">No Classes Detected</h3>
                      <p className="text-slate-500 max-w-md mx-auto mb-10 font-medium">
                        {showArchived ? "The archives are currently empty." : "Establish your first learning cohort to begin deploying vocabulary challenges."}
                      </p>
                      {!showArchived && (
                        <button 
                          onClick={() => setShowCreateClassModal(true)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest py-4 px-10 rounded-2xl shadow-xl transition-all transform hover:scale-105"
                        >
                          Create First Class
                        </button>
                      )}
                    </div>
                  ) : (
                    cohorts.map((cohort) => {
                      const themeColor = cohort.theme_color || 'indigo';
                      
                      const colorMap = {
                        indigo: {
                          accent: 'text-indigo-400',
                          border: 'border-indigo-500/30',
                          hoverBorder: 'group-hover:border-indigo-500',
                          bg: 'bg-indigo-500/5',
                          glow: 'shadow-[0_0_40px_rgba(99,102,241,0.1)]',
                          btn: 'bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]',
                          topBar: 'bg-indigo-500'
                        },
                        emerald: {
                          accent: 'text-emerald-400',
                          border: 'border-emerald-500/30',
                          hoverBorder: 'group-hover:border-emerald-500',
                          bg: 'bg-emerald-500/5',
                          glow: 'shadow-[0_0_40px_rgba(16,185,129,0.1)]',
                          btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]',
                          topBar: 'bg-emerald-500'
                        },
                        rose: {
                          accent: 'text-rose-400',
                          border: 'border-rose-500/30',
                          hoverBorder: 'group-hover:border-rose-500',
                          bg: 'bg-rose-500/5',
                          glow: 'shadow-[0_0_40px_rgba(244,63,94,0.1)]',
                          btn: 'bg-rose-600 hover:bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]',
                          topBar: 'bg-rose-500'
                        },
                        amber: {
                          accent: 'text-amber-400',
                          border: 'border-amber-500/30',
                          hoverBorder: 'group-hover:border-amber-500',
                          bg: 'bg-amber-500/5',
                          glow: 'shadow-[0_0_40px_rgba(245,158,11,0.1)]',
                          btn: 'bg-amber-600 hover:bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
                          topBar: 'bg-amber-500'
                        },
                        cyan: {
                          accent: 'text-cyan-400',
                          border: 'border-cyan-500/30',
                          hoverBorder: 'group-hover:border-cyan-500',
                          bg: 'bg-cyan-500/5',
                          glow: 'shadow-[0_0_40px_rgba(6,182,212,0.1)]',
                          btn: 'bg-cyan-600 hover:bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]',
                          topBar: 'bg-cyan-500'
                        }
                      };

                      const colorStyles = colorMap[themeColor as keyof typeof colorMap] || colorMap.indigo;

                      return (
                        <div 
                          key={cohort.id} 
                          className={`relative bg-slate-900 rounded-[2.5rem] border-2 ${colorStyles.border} ${colorStyles.hoverBorder} ${colorStyles.glow} transition-all duration-500 group flex flex-col overflow-hidden h-full transform hover:-translate-y-2`}
                        >
                          {/* Top Accent Bar */}
                          <div className={`h-2 w-full ${colorStyles.topBar}`}></div>
                          
                          <div className="p-8 flex flex-col h-full">
                            <div className="flex justify-between items-start mb-8">
                              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${colorStyles.bg} border border-white/5 shadow-inner`}>
                                <UsersRound className={`w-7 h-7 ${colorStyles.accent}`} />
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingClass(cohort);
                                    setEncounterRate(cohort.boss_encounter_rate || 15);
                                    setAiStrictness(cohort.ai_strictness || 'standard');
                                    setShowClassSettingsModal(true);
                                  }}
                                  className="p-3 text-slate-600 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all z-10 relative"
                                  title="Class Settings"
                                >
                                  <Settings className="w-5 h-5" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleArchiveCohort(cohort.id);
                                  }}
                                  className="p-3 text-slate-600 hover:text-amber-400 hover:bg-amber-400/10 rounded-xl transition-all z-10 relative"
                                  title="Archive Class"
                                >
                                  <Archive className="w-5 h-5" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleDeleteCohort(cohort.id);
                                  }}
                                  className="p-3 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all z-10 relative"
                                  title="Delete Class"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </div>

                            <h3 className="text-lg font-black text-white mb-2 tracking-tight uppercase leading-tight">{cohort.name}</h3>
                            <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mb-8">
                              Created {new Date(cohort.created_at).toLocaleDateString()}
                            </p>
                            
                            <div className="mb-10 space-y-3">
                              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Access Credentials</label>
                              <div className="bg-slate-800 p-3 rounded-xl flex items-center justify-between border border-slate-700 shadow-inner group-hover:border-slate-600 transition-all">
                                <code className={`text-2xl font-mono font-black tracking-[0.2em] ${colorStyles.accent} pl-2`}>
                                  {cohort.join_code}
                                </code>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(cohort.join_code);
                                    showToast('Code copied to clipboard!');
                                  }}
                                  className="p-2 text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                                  title="Copy Code"
                                >
                                  <Copy className="w-5 h-5" />
                                </button>
                              </div>
                            </div>

                            <div className="mt-auto pt-8 border-t border-slate-800/50 flex items-center justify-between">
                              <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Enrollment</p>
                                <p className="text-3xl font-black text-white tracking-tight">{cohort.student_count || 0}</p>
                              </div>
                              <button 
                                onClick={() => {
                                  setSelectedClassDetails(cohort);
                                  fetchClassRoster(cohort.id);
                                }}
                                className={`px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all transform hover:scale-105 active:scale-95 text-white ${colorStyles.btn}`}
                              >
                                View Roster
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl animate-in slide-in-from-right-8 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <button 
                    onClick={() => setSelectedClassDetails(null)}
                    className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      {selectedClassDetails.name} Roster
                    </h2>
                    <p className="text-sm text-slate-400">Manage students enrolled in this class.</p>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-800/50 text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">
                        <th className="px-6 py-4">Student Name</th>
                        <th className="px-6 py-4">Email</th>
                        <th className="px-6 py-4">Current Rank</th>
                        <th className="px-6 py-4">Total XP</th>
                        <th className="px-6 py-4">Last Active</th>
                        <th className="px-6 py-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {isLoadingClassRoster ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-2" />
                            <p className="text-sm text-slate-500">Loading roster...</p>
                          </td>
                        </tr>
                      ) : classRoster.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <p className="text-sm text-slate-500">No students enrolled in this class.</p>
                          </td>
                        </tr>
                      ) : (
                        classRoster.map((student) => {
                          const lastActiveDate = student.lastActive ? new Date(student.lastActive) : new Date(student.createdAt);
                          const daysSinceActive = Math.floor((new Date().getTime() - lastActiveDate.getTime()) / (1000 * 3600 * 24));
                          const isInactive = daysSinceActive > 7;

                          return (
                            <tr key={student.id} className="hover:bg-slate-800/30 transition-colors group">
                              <td className="px-6 py-4 font-bold text-slate-200">{student.name}</td>
                              <td className="px-6 py-4 text-sm text-slate-400">{student.email}</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter ${
                                  student.rank === 'Gold' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' :
                                  student.rank === 'Silver' ? 'bg-slate-400/10 text-slate-400 border border-slate-400/20' :
                                  'bg-orange-700/10 text-orange-600 border border-orange-700/20'
                                }`}>
                                  {student.rank}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-mono text-sm text-indigo-400">{student.xp?.toLocaleString() || 0}</td>
                              <td className="px-6 py-4">
                                <span className={`text-sm font-bold ${isInactive ? 'text-red-400' : 'text-slate-400'}`}>
                                  {daysSinceActive === 0 ? 'Today' : `${daysSinceActive} days ago`}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => setMovingStudent(student)}
                                    className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-indigo-400 transition-colors"
                                    title="Move Student"
                                  >
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => setRemovingStudent(student)}
                                    className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400 transition-colors"
                                    title="Remove Student"
                                  >
                                    <UserMinus className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {viewMode === 'deploy' && activeTab === 'activity' && (
          <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <History className="w-6 h-6 text-indigo-400" />
                Word Bank
              </h2>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search term..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full sm:w-48"
                  />
                </div>
                <select
                  value={filterClass}
                  onChange={(e) => setFilterClass(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full sm:w-auto"
                >
                  <option value="">All Classes</option>
                  {cohorts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
                <select
                  value={filterNovel}
                  onChange={(e) => setFilterNovel(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500 outline-none w-full sm:w-auto"
                >
                  <option value="">All Contexts</option>
                  {Array.from(new Set(recentItems.map(item => item.novel_node).filter(Boolean))).map(novel => (
                    <option key={novel} value={novel}>{novel}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="overflow-hidden rounded-xl border border-slate-700">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 text-slate-500 text-[10px] uppercase tracking-widest font-bold">
                    <th className="px-6 py-4">Term</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Classes</th>
                    <th className="px-6 py-4">Novel Context</th>
                    <th className="px-6 py-4">Reviews</th>
                    <th className="px-6 py-4">Mastery %</th>
                    <th className="px-6 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {recentItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-500 italic">No content has been deployed yet.</td>
                    </tr>
                  ) : (
                    recentItems
                      .filter(item => {
                        if (searchQuery && !item.term.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                        if (filterClass && !(item.target_classes || []).includes(filterClass) && item.cohort_id !== filterClass) return false;
                        if (filterNovel && item.novel_node !== filterNovel) return false;
                        return true;
                      })
                      .map((item) => (
                      <tr key={item.id} className={`hover:bg-slate-700/30 transition-colors group ${item.is_active === false ? 'opacity-50 grayscale' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-bold">{item.term}</span>
                            {item.is_active === false && (
                              <span className="text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-slate-500/20 text-slate-400">
                                INACTIVE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${item.item_type === 'vocab' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                            {item.item_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">
                          {(item.target_classes || []).join(', ') || item.cohort_id || '—'}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400 italic">{item.novel_node || '—'}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{item.totalReviews || 0}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{item.masteryPercentage || 0}%</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => {
                                setEditingItem(item);
                                setEditTerm(item.term);
                                setEditDefinition(item.definition);
                              }}
                              className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
                              title="Edit"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleToggleStatus(item.id, item.is_active !== false)}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${item.is_active !== false ? 'bg-emerald-500' : 'bg-slate-600'}`}
                              title={item.is_active !== false ? "Retire Content" : "Activate Content"}
                            >
                              <span className="sr-only">Toggle status</span>
                              <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${item.is_active !== false ? 'translate-x-5' : 'translate-x-1'}`}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4 relative animate-in zoom-in-95 duration-200">
              <button 
                onClick={() => setEditingItem(null)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-indigo-400" />
                Edit Content
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Term</label>
                  <input 
                    type="text" 
                    value={editTerm}
                    onChange={(e) => setEditTerm(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Definition</label>
                  <textarea 
                    value={editDefinition}
                    onChange={(e) => setEditDefinition(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none h-32 resize-none"
                  />
                </div>
                
                <button 
                  onClick={handleSaveEdit}
                  disabled={!editTerm || !editDefinition}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Move Student Modal */}
        {movingStudent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4 relative animate-in zoom-in-95 duration-200">
              <button 
                onClick={() => setMovingStudent(null)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
                Move Student
              </h2>

              <p className="text-sm text-slate-400 mb-6">
                Move <span className="font-bold text-white">{movingStudent.name}</span> to a different class.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Select New Class</label>
                  <select 
                    value={newCohortForStudent}
                    onChange={(e) => setNewCohortForStudent(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">-- Select Class --</option>
                    {cohorts.filter(c => c.id !== selectedClassDetails?.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                
                <button 
                  onClick={handleMoveStudent}
                  disabled={!newCohortForStudent}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ArrowRightLeft className="w-5 h-5" />
                  Move Student
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remove Student Modal */}
        {removingStudent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-w-md w-full mx-4 relative animate-in zoom-in-95 duration-200">
              <button 
                onClick={() => setRemovingStudent(null)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <UserMinus className="w-5 h-5 text-red-400" />
                Remove Student
              </h2>

              <p className="text-sm text-slate-400 mb-6">
                Are you sure you want to remove <span className="font-bold text-white">{removingStudent.name}</span> from <span className="font-bold text-white">{selectedClassDetails?.name}</span>? They will be unenrolled from this class.
              </p>

              <div className="flex gap-4">
                <button 
                  onClick={() => setRemovingStudent(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleRemoveStudent}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <UserMinus className="w-5 h-5" />
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'analytics' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Student Roster Analytics</h2>
                  <p className="text-sm text-slate-400">Real-time mastery tracking and decay alerts.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={exportToCSV}
                    disabled={roster.length === 0}
                    className="flex items-center gap-2 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    Download CSV
                  </button>
                  <button 
                    onClick={fetchRoster}
                    disabled={isLoadingRoster}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-indigo-400"
                  >
                    <History className={`w-5 h-5 ${isLoadingRoster ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/50 text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">
                      <th className="px-6 py-4">Student Name</th>
                      <th className="px-6 py-4">Rank</th>
                      <th className="px-6 py-4">Total XP</th>
                      <th className="px-6 py-4">Mastered Words</th>
                      <th className="px-6 py-4">Decaying Words</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {isLoadingRoster ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center">
                          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Calculating mastery metrics...</p>
                        </td>
                      </tr>
                    ) : roster.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center">
                          <p className="text-sm text-slate-500">No student data found.</p>
                        </td>
                      </tr>
                    ) : (
                      roster.map((student, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-200">{student.name}</div>
                            <div className="text-[10px] text-slate-500">{student.email}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter ${
                              student.rank === 'Gold' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' :
                              student.rank === 'Silver' ? 'bg-slate-400/10 text-slate-400 border border-slate-400/20' :
                              'bg-orange-700/10 text-orange-600 border border-orange-700/20'
                            }`}>
                              {student.rank}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-mono text-sm text-indigo-400">
                            {student.xp.toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-bold text-emerald-400">{student.masteredItems}</span>
                              <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-emerald-500" 
                                  style={{ width: `${Math.min(100, (student.masteredItems / 50) * 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-lg transition-all duration-500 ${
                              student.decayingMastery > 0 
                                ? 'text-red-400 font-bold drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]' 
                                : 'text-slate-600'
                            }`}>
                              {student.decayingMastery}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Class Mastery Avg</h4>
                <p className="text-3xl font-bold text-white">
                  {roster.length > 0 
                    ? (roster.reduce((acc, s) => acc + s.masteredItems, 0) / roster.length).toFixed(1)
                    : '0.0'
                  }
                </p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">At-Risk Students</h4>
                <p className="text-3xl font-bold text-red-400">
                  {roster.filter(s => s.decayingMastery > 0).length}
                </p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Total Class XP</h4>
                <p className="text-3xl font-bold text-indigo-400">
                  {roster.reduce((acc, s) => acc + s.xp, 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'bottlenecks' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Content Bottlenecks</h2>
                  <p className="text-sm text-slate-400">Identify learning items students are struggling with.</p>
                </div>
                <div className="flex items-center gap-4">
                  <select 
                    value={cohortId}
                    onChange={(e) => {
                      setCohortId(e.target.value);
                      fetchBottlenecks(e.target.value);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  >
                    {cohorts.length === 0 ? (
                      <option value="">No classes found</option>
                    ) : (
                      cohorts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)
                    )}
                  </select>
                  <button 
                    onClick={() => fetchBottlenecks(cohortId)}
                    disabled={isLoadingBottlenecks || !cohortId}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-indigo-400"
                  >
                    <History className={`w-5 h-5 ${isLoadingBottlenecks ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/50 text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">
                      <th className="px-6 py-4">Term / Concept</th>
                      <th className="px-6 py-4">Total Reviews</th>
                      <th className="px-6 py-4">Avg. Time</th>
                      <th className="px-6 py-4">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {isLoadingBottlenecks ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center">
                          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Analyzing content performance...</p>
                        </td>
                      </tr>
                    ) : bottlenecks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center">
                          <p className="text-sm text-slate-500">No bottleneck data found for this class.</p>
                        </td>
                      </tr>
                    ) : (
                      bottlenecks.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-200">{item.term}</div>
                          </td>
                          <td className="px-6 py-4 font-mono text-sm text-slate-400">
                            {item.totalReviews}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`font-mono text-sm ${item.averageResponseTime > 10000 ? 'text-yellow-400 font-bold' : 'text-slate-400'}`}>
                              {(item.averageResponseTime / 1000).toFixed(1)}s
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-bold w-12 ${
                                item.accuracyRate < 60 ? 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]' :
                                item.accuracyRate < 85 ? 'text-yellow-400' :
                                'text-emerald-400'
                              }`}>
                                {item.accuracyRate.toFixed(0)}%
                              </span>
                              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full ${
                                    item.accuracyRate < 60 ? 'bg-red-500' :
                                    item.accuracyRate < 85 ? 'bg-yellow-500' :
                                    'bg-emerald-500'
                                  }`}
                                  style={{ width: `${item.accuracyRate}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Router Setup ---

function ProtectedRoute({ children, allowedRole }: { children: React.ReactNode, allowedRole?: string }) {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && role !== allowedRole) {
    // Redirect to appropriate home if wrong role
    return <Navigate to={role === 'teacher' ? '/dashboard' : '/arena'} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const currentToken = localStorage.getItem('token');
    if (currentToken === 'dev-token-nbend-2026') {
      setIsChecking(false);
      return;
    }

    if (!isFirebaseConfigured()) {
      setIsChecking(false);
      return;
    }

    // Listen for Firebase auth state changes to keep token fresh
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          // Refresh token if needed
          const token = await user.getIdToken();
          localStorage.setItem('token', token);
        } else {
          // Only remove if it's not the dev token
          const token = localStorage.getItem('token');
          if (token !== 'dev-token-nbend-2026') {
            localStorage.removeItem('token');
            localStorage.removeItem('role');
          }
        }
        setIsChecking(false);
      });

      return () => unsubscribe();
    } else {
      setIsChecking(false);
    }
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-900">
        <Navbar />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <Navigate to={localStorage.getItem('role') === 'teacher' ? '/dashboard' : '/arena'} replace />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/arena" 
            element={
              <ProtectedRoute>
                <Arena />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute allowedRole="teacher">
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
