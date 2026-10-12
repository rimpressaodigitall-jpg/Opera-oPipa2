import { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  User
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import AdminApp from './components/AdminApp';
import DriverApp from './components/DriverApp';
import AndroidInstallBanner from './components/AndroidInstallBanner';
import { 
  Droplet, 
  LayoutDashboard,
  Lock,
  ChevronRight,
  Shield,
  AlertCircle,
  Truck,
  ArrowLeft,
  Smartphone,
  Eye,
  EyeOff,
  CheckCircle2,
  Navigation,
  Sparkles,
  Settings,
  Save,
  Key,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Specific role persistence: admin, secretary, driver
  const [selectedAccess, setSelectedAccess] = useState<'admin' | 'secretary' | 'driver' | null>(() => {
    return (localStorage.getItem('pipa_access_role') as 'admin' | 'secretary' | 'driver') || null;
  });

  const [appRole, setAppRole] = useState<'admin' | 'secretary' | 'driver' | null>(() => {
    const role = (localStorage.getItem('pipa_access_role') as 'admin' | 'secretary' | 'driver') || null;
    const adminAuth = localStorage.getItem('pipa_admin_auth') === 'true';
    if (role === 'driver') return 'driver';
    if (role === 'secretary' && adminAuth) return 'secretary';
    if (role === 'admin' && adminAuth) return 'admin';
    return null;
  });
  
  // Admin Password States
  const [adminPassword, setAdminPassword] = useState('');
  const [showPlainPassword, setShowPlainPassword] = useState(false);
  
  const [storedAdminPassword, setStoredAdminPassword] = useState<string | null>(null);
  const [storedSecretaryPassword, setStoredSecretaryPassword] = useState<string>('');
  const [storedDriverPassword, setStoredDriverPassword] = useState<string>('');
  const [adminSessionExpired, setAdminSessionExpired] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string>('');
  
  const [newAdminPass, setNewAdminPass] = useState('');
  const [newSecPass, setNewSecPass] = useState('');
  const [newDriverPass, setNewDriverPass] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [isSavingPass, setIsSavingPass] = useState(false);

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('pipa_admin_auth') === 'true';
  });
  const [isCheckingPassword, setIsCheckingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [isLoggingInGoogle, setIsLoggingInGoogle] = useState(false);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [authError, setAuthError] = useState<{ code: string; message: string; hostname: string } | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleQuotaExceeded = () => setQuotaExceeded(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('firebase-quota-exceeded', handleQuotaExceeded);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('firebase-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  useEffect(() => {
    if (user) {
      fetchOrCreateVapidKeys();
    }
  }, [user]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        // Logged out: reset roles and clear persistence
        setAppRole(null);
        setSelectedAccess(null);
        setIsAdminAuthenticated(false);
        setShowPasswordPrompt(false);
        localStorage.removeItem('pipa_access_role');
        localStorage.removeItem('pipa_admin_auth');
      } else {
        const savedRole = localStorage.getItem('pipa_access_role') as 'admin' | 'secretary' | 'driver' | null;
        const savedAdminAuth = localStorage.getItem('pipa_admin_auth') === 'true';
        if (savedRole === 'driver') {
          setAppRole('driver');
          setSelectedAccess('driver');
        } else if (savedRole === 'secretary') {
          setSelectedAccess('secretary');
          if (savedAdminAuth) {
            setAppRole('secretary');
            setIsAdminAuthenticated(true);
          }
        } else if (savedRole === 'admin') {
          setSelectedAccess('admin');
          if (savedAdminAuth) {
            setAppRole('admin');
            setIsAdminAuthenticated(true);
          }
        }
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (storedAdminPassword) {
      setNewAdminPass(storedAdminPassword);
    }
    if (storedSecretaryPassword) {
      setNewSecPass(storedSecretaryPassword);
    }
    if (storedDriverPassword !== undefined) {
      setNewDriverPass(storedDriverPassword);
    }
  }, [storedAdminPassword, storedSecretaryPassword, storedDriverPassword]);

  useEffect(() => {
    if (appRole !== 'admin' || !user) return;

    // Listener de tempo real para detectar se outro Administrador fez login em outro lugar
    const unsubAdminSession = onSnapshot(doc(db, 'config', 'admin_session'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const localSessionId = localStorage.getItem('pipa_admin_session_id');
        if (data.activeSessionId && localSessionId && data.activeSessionId !== localSessionId) {
          setAdminSessionExpired(true);
          // Limpa credenciais locais
          localStorage.removeItem('pipa_access_role');
          localStorage.removeItem('pipa_admin_auth');
          localStorage.removeItem('pipa_admin_session_id');
          setAppRole(null);
          setSelectedAccess(null);
          setIsAdminAuthenticated(false);
        }
      }
    });

    return () => {
      unsubAdminSession();
    };
  }, [appRole, user]);

  const fetchAdminConfig = async () => {
    setFirebaseError(null);
    try {
      const adminDoc = await getDoc(doc(db, 'config', 'admin'));
      let password = '123456';
      let secretaryPassword = '';
      let driverPassword = '';
      
      if (adminDoc.exists()) {
        const data = adminDoc.data();
        password = data?.password || '123456';
        secretaryPassword = data?.secretaryPassword || '';
        driverPassword = data?.driverPassword || '';
      } else {
        try {
          await setDoc(doc(db, 'config', 'admin'), {
            password: '123456',
            secretaryPassword: '',
            driverPassword: '',
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.warn("Could not create admin doc:", e);
        }
      }
      setStoredAdminPassword(password);
      setStoredSecretaryPassword(secretaryPassword);
      setStoredDriverPassword(driverPassword);
      return { password, secretaryPassword, driverPassword };
    } catch (error) {
      console.error("Error fetching admin config:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('offline') || (error as any)?.code === 'unavailable' || errorMessage.includes('unavailable')) {
        setFirebaseError("Sistema operando em modo offline. Algumas funções podem estar limitadas.");
      } else if (errorMessage.includes('permission')) {
        handleFirestoreError(error, OperationType.GET, 'config/admin');
      } else {
        setFirebaseError("Erro ao conectar com o servidor. Usando configurações padrão.");
      }
      
      setStoredAdminPassword('123456');
      setStoredSecretaryPassword('');
      setStoredDriverPassword('');
      return { password: '123456', secretaryPassword: '', driverPassword: '' };
    }
  };

  const fetchOrCreateVapidKeys = async () => {
    const fallbackKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    if (!auth.currentUser) {
      setVapidPublicKey(fallbackKey);
      return fallbackKey;
    }
    try {
      const vapidDocRef = doc(db, 'config', 'vapid');
      const vapidDoc = await getDoc(vapidDocRef);
      
      if (vapidDoc.exists()) {
        const data = vapidDoc.data();
        if (data.publicKey) {
          setVapidPublicKey(data.publicKey);
          return data.publicKey;
        }
      }

      // Check if Web Crypto API is available (Secure Context required)
      if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        setVapidPublicKey(fallbackKey);
        return fallbackKey;
      }

      // Generates P-256 standard key pair using Web Crypto API
      const keyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );

      const publicKeyBuffer = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
      const privateKeyBuffer = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

      const base64UrlEncode = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      };

      const publicKey = base64UrlEncode(publicKeyBuffer);
      const privateKey = base64UrlEncode(privateKeyBuffer);

      await setDoc(vapidDocRef, {
        publicKey,
        privateKey,
        generatedAt: new Date().toISOString()
      });

      setVapidPublicKey(publicKey);
      return publicKey;
    } catch (err) {
      console.warn("VAPID config fallback:", err);
      setVapidPublicKey(fallbackKey);
      return fallbackKey;
    }
  };

  const handleChooseAccess = async (choice: 'admin' | 'secretary' | 'driver') => {
    setSelectedAccess(choice);
    if (user) {
      setIsCheckingPassword(true);
      const config = await fetchAdminConfig();
      setIsCheckingPassword(false);
      
      if (choice === 'driver') {
        if (config.driverPassword) {
          setShowPasswordPrompt(true);
        } else {
          localStorage.setItem('pipa_access_role', 'driver');
          setAppRole('driver');
        }
      } else {
        setShowPasswordPrompt(true);
      }
    }
  };

  const loginWithGoogle = async (targetRole?: 'admin' | 'secretary' | 'driver') => {
    const role = targetRole || selectedAccess;
    if (!role) return;
    setIsLoggingInGoogle(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        setSelectedAccess(role);
        setIsCheckingPassword(true);
        const config = await fetchAdminConfig();
        setIsCheckingPassword(false);
        
        if (role === 'driver') {
          if (config.driverPassword) {
            setShowPasswordPrompt(true);
          } else {
            localStorage.setItem('pipa_access_role', 'driver');
            setAppRole('driver');
          }
        } else {
          setShowPasswordPrompt(true);
        }
      }
    } catch (error: any) {
      console.error("Erro ao autenticar com Google:", error);
      const code = error?.code || 'auth/unknown';
      const message = error?.message || String(error);
      setAuthError({
        code,
        message,
        hostname: typeof window !== 'undefined' ? window.location.hostname : ''
      });
    } finally {
      setIsLoggingInGoogle(false);
    }
  };

  const handleResetToDefaultPassword = async () => {
    try {
      await setDoc(doc(db, 'config', 'admin'), {
        password: '123456',
        secretaryPassword: '',
        driverPassword: '',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn("Could not save to firestore:", e);
    }
    setStoredAdminPassword('123456');
    setStoredSecretaryPassword('');
    setStoredDriverPassword('');
    setAdminPassword('123456');
    setPasswordError('');
  };

  const verifyPassword = async () => {
    if (selectedAccess === 'admin') {
      const effectivePassword = storedAdminPassword || '123456';
      if (adminPassword === effectivePassword) {
        const token = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        try {
          await setDoc(doc(db, 'config', 'admin_session'), {
            activeSessionId: token,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (e) {
          console.error("Erro ao registrar sessão de admin:", e);
        }
        localStorage.setItem('pipa_admin_session_id', token);
        localStorage.setItem('pipa_access_role', 'admin');
        localStorage.setItem('pipa_admin_auth', 'true');
        setIsAdminAuthenticated(true);
        setAppRole('admin');
        setShowPasswordPrompt(false);
        setPasswordError('');
      } else {
        setPasswordError('Senha incorreta');
      }
    } else if (selectedAccess === 'secretary') {
      const effectivePassword = storedSecretaryPassword || '';
      if (!effectivePassword) {
        setPasswordError('Acesso de secretário não configurado. Peça ao administrador para definir uma senha.');
        return;
      }
      if (adminPassword === effectivePassword) {
        localStorage.setItem('pipa_access_role', 'secretary');
        localStorage.setItem('pipa_admin_auth', 'true');
        setIsAdminAuthenticated(true);
        setAppRole('secretary');
        setShowPasswordPrompt(false);
        setPasswordError('');
      } else {
        setPasswordError('Senha incorreta');
      }
    } else if (selectedAccess === 'driver') {
      const effectivePassword = storedDriverPassword || '';
      if (!effectivePassword || adminPassword === effectivePassword) {
        localStorage.setItem('pipa_access_role', 'driver');
        localStorage.setItem('pipa_admin_auth', 'true');
        setAppRole('driver');
        setShowPasswordPrompt(false);
        setPasswordError('');
      } else {
        setPasswordError('Senha incorreta');
      }
    }
  };

  const handleSavePasswords = async () => {
    setIsSavingPass(true);
    setSaveMessage('');
    try {
      await setDoc(doc(db, 'config', 'admin'), {
        password: newAdminPass.trim() || '123456',
        secretaryPassword: newSecPass.trim(),
        driverPassword: newDriverPass.trim(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      
      setStoredAdminPassword(newAdminPass.trim() || '123456');
      setStoredSecretaryPassword(newSecPass.trim());
      setStoredDriverPassword(newDriverPass.trim());
      
      setSaveMessage('Senhas salvas com sucesso no banco de dados!');
      setTimeout(() => setSaveMessage(''), 4000);
    } catch (err) {
      console.error("Failed to save passwords:", err);
      setSaveMessage('Erro ao salvar as senhas. Verifique a conexão.');
    } finally {
      setIsSavingPass(false);
    }
  };

  const handleTrocarAcesso = () => {
    localStorage.removeItem('pipa_access_role');
    localStorage.removeItem('pipa_admin_auth');
    setAppRole(null);
    setSelectedAccess(null);
    setIsAdminAuthenticated(false);
    setShowPasswordPrompt(false);
    setAdminPassword('');
    setPasswordError('');
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-brand-primary/10">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-brand-dark">
          <Droplet size={48} />
        </motion.div>
      </div>
    );
  }

  if (adminSessionExpired) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 p-4">
        <div className="max-w-sm w-full bg-slate-900 p-6 rounded-2xl border border-slate-800 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-base font-black uppercase tracking-tight text-white leading-tight">Sessão Encerrada</h2>
          <p className="text-slate-400 text-xs leading-normal">
            Sua sessão de Administrador foi encerrada porque outro dispositivo ou aba fez login como Administrador neste momento.
          </p>
          <button
            onClick={() => {
              setAdminSessionExpired(false);
              handleTrocarAcesso();
            }}
            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-lg text-xs uppercase tracking-wider transition-all cursor-pointer"
          >
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  // Active View: Motorista (Locked role, no role switching)
  if (user && appRole === 'driver') {
    return (
      <div className="h-screen flex flex-col relative">
        {quotaExceeded && (
          <div className="bg-amber-500 text-amber-950 font-semibold text-xs sm:text-sm py-3 px-4 text-center justify-center flex flex-col sm:flex-row items-center gap-2 select-none shadow-md z-[1000] border-b border-amber-600/30">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={16} className="shrink-0 stroke-[2.5]" />
              <strong className="uppercase tracking-wide text-[10px] bg-amber-600/30 px-1.5 py-0.5 rounded">Cota do Firebase Excedida</strong>
            </div>
            <span>Operando de forma estável no <strong>Modo de Contingência Local</strong>. Suas ações e entregas serão salvas no aparelho!</span>
          </div>
        )}
        <DriverApp onTrocarAcesso={handleTrocarAcesso} vapidPublicKey={vapidPublicKey} />
      </div>
    );
  }

  // Active View: Secretários (Renders full dispatch dashboard)
  if (user && appRole === 'secretary' && isAdminAuthenticated) {
    return (
      <div className="h-screen flex flex-col relative">
        {quotaExceeded && (
          <div className="bg-amber-500 text-amber-950 font-semibold text-xs sm:text-sm py-3 px-4 text-center justify-center flex flex-col sm:flex-row items-center gap-2 select-none shadow-md z-[1000] border-b border-amber-600/30">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={16} className="shrink-0 stroke-[2.5]" />
              <strong className="uppercase tracking-wide text-[10px] bg-amber-600/30 px-1.5 py-0.5 rounded">Cota do Firebase Excedida</strong>
            </div>
            <span>Operando de forma estável no <strong>Modo de Contingência Local</strong>. Suas ações e entregas serão salvas no aparelho!</span>
          </div>
        )}
        <AdminApp onTrocarAcesso={handleTrocarAcesso} />
      </div>
    );
  }

  // Active View: Administrador (Módulo de Configuração de Senhas)
  if (user && appRole === 'admin' && isAdminAuthenticated) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-white font-sans flex flex-col justify-between p-3 sm:p-4 relative">
        <div 
          className="fixed inset-0 z-0 opacity-10 bg-center bg-cover pointer-events-none" 
          style={{ backgroundImage: 'url(https://i.ibb.co/v4vWjP3B/caminhao-pipa-inhapi-OMZpj2.jpg)' }} 
        />
        
        <header className="w-full max-w-md mx-auto flex items-center justify-between py-2 z-10 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <img 
              src="/brasao-inhapi.svg" 
              alt="Brasão da Prefeitura de Inhapi" 
              className="w-9 h-9 sm:w-10 sm:h-10 object-contain shrink-0 drop-shadow-[0_2px_8px_rgba(255,255,255,0.2)]" 
              onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }}
            />
            <div>
              <h1 className="text-xs font-black uppercase tracking-tight text-white leading-tight">Admin Central</h1>
              <p className="text-[8px] font-black text-cyan-400 tracking-wider uppercase leading-none mt-0.5">Operação Pipa</p>
            </div>
          </div>
          <button
            onClick={handleTrocarAcesso}
            className="flex items-center gap-1.5 px-2 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 border border-red-900/40 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
          >
            <LogOut size={12} /> Sair
          </button>
        </header>

        <main className="w-full max-w-md mx-auto flex-1 flex flex-col justify-center py-4 z-10">
          <div className="bg-slate-900/95 backdrop-blur-2xl rounded-2xl p-4 sm:p-5 border border-slate-800 shadow-2xl space-y-4">
            <div className="text-center space-y-0.5">
              <div className="w-10 h-10 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl flex items-center justify-center mx-auto mb-1.5 shadow-inner">
                <Shield size={20} />
              </div>
              <h2 className="text-sm font-black uppercase tracking-tight text-white">Configurações de Senha</h2>
              <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">
                Defina os códigos numéricos ou de texto para os perfis do sistema
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              {/* Senha do Administrador */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">
                  🔑 Senha do Administrador (Master)
                </label>
                <input 
                  type="text"
                  value={newAdminPass}
                  onChange={(e) => setNewAdminPass(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-bold outline-none focus:border-cyan-400 transition-all placeholder:text-slate-600"
                  placeholder="Senha atual ou nova senha"
                />
                <p className="text-[8px] text-slate-500 font-medium pl-1 leading-none">
                  Protege o acesso a este painel administrativo de configurações.
                </p>
              </div>

              {/* Senha do Secretário */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">
                  💼 Senha do Secretário
                </label>
                <input 
                  type="text"
                  value={newSecPass}
                  onChange={(e) => setNewSecPass(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-bold outline-none focus:border-cyan-400 transition-all placeholder:text-slate-600"
                  placeholder="Senha atual ou nova senha"
                />
                <p className="text-[8px] text-slate-500 font-medium pl-1 leading-none">
                  Libera o acesso ao painel completo de controle (despacho, relatórios, mapas).
                </p>
              </div>

              {/* Senha do Motorista */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">
                  🚚 Senha do Motorista <span className="text-slate-500 font-normal italic lowercase">(deixe vazio para livre acesso)</span>
                </label>
                <input 
                  type="text"
                  value={newDriverPass}
                  onChange={(e) => setNewDriverPass(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-bold outline-none focus:border-cyan-400 transition-all placeholder:text-slate-600"
                  placeholder="Deixe em branco para acesso direto sem senha"
                />
                <p className="text-[8px] text-slate-500 font-medium pl-1 leading-none">
                  Se configurada, os motoristas terão que digitar esta senha para abrir suas rotas.
                </p>
              </div>
            </div>

            {saveMessage && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }} 
                animate={{ opacity: 1, y: 0 }}
                className={`p-2 rounded-lg text-center font-bold text-[9px] uppercase tracking-wider border ${
                  saveMessage.includes('Erro') 
                    ? 'bg-rose-950/40 border-rose-800/40 text-rose-400' 
                    : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400'
                }`}
              >
                {saveMessage}
              </motion.div>
            )}

            <button
              onClick={handleSavePasswords}
              disabled={isSavingPass}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-cyan-950 font-black py-3 rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-cyan-500/10 text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Save size={14} />
              {isSavingPass ? 'SALVANDO...' : 'SALVAR CONFIGURAÇÕES'}
            </button>
          </div>
        </main>

        <footer className="w-full max-w-md mx-auto text-center pb-2 z-10 border-t border-slate-800/80 pt-2">
          <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
            Prefeitura de Inhapi • Operação Pipa 2026
          </p>
        </footer>
      </div>
    );
  }

  // Flow Step 2: User selected an access role first, and now the Google Login appears for that specific access
  if (selectedAccess && !user) {
    const isAdmin = selectedAccess === 'admin';
    const isSecretary = selectedAccess === 'secretary';
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(37,99,235,0.25),rgba(255,255,255,0))] p-3 sm:p-4 overflow-y-auto">
        <motion.div 
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="max-w-xs w-full bg-slate-900/90 backdrop-blur-2xl p-4 sm:p-5 rounded-2xl shadow-2xl border border-slate-800 text-center relative overflow-hidden my-auto"
        >
          {/* Subtle top ambient indicator */}
          <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${isAdmin ? 'from-red-600 to-amber-500' : isSecretary ? 'from-blue-600 to-indigo-500' : 'from-cyan-500 to-emerald-500'}`} />

          {/* Role badge */}
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide mb-3 bg-slate-800/80 text-slate-300 border border-slate-700/60">
            {isAdmin ? <Shield size={12} className="text-red-400" /> : isSecretary ? <LayoutDashboard size={12} className="text-blue-400" /> : <Truck size={12} className="text-cyan-400" />}
            <span>Acesso: {isAdmin ? 'Administração' : isSecretary ? 'Secretaria' : 'Motorista'}</span>
          </div>

          <div className="flex items-center justify-center mx-auto mb-3">
            <img 
              src="/brasao-inhapi.svg" 
              alt="Brasão da Prefeitura de Inhapi" 
              className="w-16 h-16 sm:w-18 sm:h-18 object-contain drop-shadow-[0_4px_12px_rgba(255,255,255,0.18)]"
              onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }}
            />
          </div>

          <h2 className="text-base font-bold mb-1 tracking-tight text-white">
            {isAdmin ? 'Login do Administrador' : isSecretary ? 'Login do Secretário' : 'Login do Motorista'}
          </h2>
          <p className="text-slate-400 mb-5 text-[11px] leading-normal max-w-xs mx-auto">
            {isAdmin 
              ? 'Conecte sua conta autorizada para configurar as senhas de acesso do sistema.' 
              : isSecretary
                ? 'Conecte sua conta para gerenciar rotas, relatórios e motoristas.'
                : 'Conecte sua conta para iniciar turnos e registrar fotos de entregas.'}
          </p>

          <button 
            disabled={isLoggingInGoogle}
            onClick={() => loginWithGoogle(selectedAccess)}
            className="w-full bg-white hover:bg-slate-100 text-slate-900 font-semibold py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-black/20 text-xs disabled:opacity-50 cursor-pointer"
          >
            {isLoggingInGoogle ? (
              <Droplet className="animate-spin text-blue-600" size={14} />
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg" className="shrink-0 mr-1.5">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
            )}
            Entrar com o Google
          </button>

          {authError && (
            <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-left text-slate-200 space-y-1.5 text-[10px]">
              <div className="flex items-center gap-1.5 text-red-400 font-semibold">
                <AlertCircle size={12} className="shrink-0" />
                <span>Erro de Autenticação</span>
              </div>
              
              {authError.code === 'auth/unauthorized-domain' ? (
                <div className="space-y-1 leading-normal text-slate-300">
                  <p className="font-medium text-red-300">
                    O domínio atual não está autorizado.
                  </p>
                  <p className="text-slate-400">
                    Passos para autorizar:
                  </p>
                  <ol className="list-decimal pl-3 text-slate-300 space-y-0.5">
                    <li>Acesse o Console do Firebase.</li>
                    <li>Vá em Auth &rarr; Settings &rarr; Authorized domains.</li>
                    <li>Adicione: <code className="bg-slate-800 px-1 rounded border border-slate-700 font-mono text-cyan-300 font-semibold">{authError.hostname}</code></li>
                  </ol>
                </div>
              ) : authError.code === 'auth/popup-closed-by-user' ? (
                <p className="text-slate-400">
                  A janela de login foi fechada. Tente novamente acima.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-slate-400">
                    Erro de conexão:
                  </p>
                  <code className="block bg-slate-950 p-1 rounded border border-slate-800 font-mono text-[9px] text-red-400 break-all select-all">
                    {authError.message}
                  </code>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-slate-800">
            <button
              onClick={() => {
                setSelectedAccess(null);
                setShowPasswordPrompt(false);
              }}
              className="text-slate-400 hover:text-white font-medium text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft size={12} /> Voltar à seleção
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Flow Step 1: User chooses access option FIRST (Administrador, Secretários ou Motorista)
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(37,99,235,0.2),rgba(255,255,255,0))] p-3 sm:p-4 overflow-y-auto">
      <div className="max-w-2xl w-full my-auto py-3 sm:py-6">
        
        {/* Header Branding */}
        <div className="text-center mb-4 sm:mb-6">
          <div className="flex items-center justify-center mb-2.5">
            <img 
              src="/brasao-inhapi.svg" 
              alt="Brasão da Prefeitura de Inhapi" 
              className="w-18 h-18 sm:w-22 sm:h-22 object-contain drop-shadow-[0_4px_16px_rgba(255,255,255,0.2)]"
              onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }}
            />
          </div>
          
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
            Operação Pipa
          </h1>
          <p className="text-slate-400 font-bold text-[10px] sm:text-xs mt-0.5 max-w-xs mx-auto uppercase tracking-wider">
            Gestão Hídrica • Inhapi / AL
          </p>

          <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full bg-slate-900/60 border border-slate-800 text-[9px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
            <span>Selecione seu perfil de acesso</span>
          </div>
        </div>

        {/* Role Choice Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {/* Opção 1: Administrador */}
          <button 
            disabled={isCheckingPassword}
            onClick={() => handleChooseAccess('admin')}
            className="group relative bg-slate-900/80 hover:bg-slate-900 backdrop-blur-xl p-3.5 sm:p-4 rounded-xl border border-slate-800 hover:border-red-500/60 text-left transition-all hover:shadow-lg hover:shadow-red-500/5 active:scale-[0.98] disabled:opacity-50 cursor-pointer flex flex-col justify-between min-h-[140px] sm:min-h-[180px]"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-7 h-7 rounded-lg bg-red-600/15 border border-red-500/30 text-red-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <Key size={14} className="stroke-[2]" />
                </div>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-widest">
                  ADM
                </span>
              </div>

              <h2 className="text-xs sm:text-sm font-black text-white tracking-tight">
                Administrador
              </h2>
              <p className="text-slate-400 text-[10px] leading-normal mt-1">
                Configuração segura das senhas de acesso de usuários.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-bold text-red-400 group-hover:text-red-300 uppercase tracking-wider">
              <span>Definir Senhas</span>
              <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* Opção 2: Secretários */}
          <button 
            disabled={isCheckingPassword}
            onClick={() => handleChooseAccess('secretary')}
            className="group relative bg-slate-900/80 hover:bg-slate-900 backdrop-blur-xl p-3.5 sm:p-4 rounded-xl border border-slate-800 hover:border-blue-500/60 text-left transition-all hover:shadow-lg hover:shadow-blue-500/5 active:scale-[0.98] disabled:opacity-50 cursor-pointer flex flex-col justify-between min-h-[140px] sm:min-h-[180px]"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-7 h-7 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <LayoutDashboard size={14} className="stroke-[2]" />
                </div>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-widest">
                  SECRETARIA
                </span>
              </div>

              <h2 className="text-xs sm:text-sm font-black text-white tracking-tight">
                Secretários
              </h2>
              <p className="text-slate-400 text-[10px] leading-normal mt-1">
                Monitoramento de frotas, despacho de rotas e relatórios.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-bold text-blue-400 group-hover:text-blue-300 uppercase tracking-wider">
              <span>Abrir Painel</span>
              <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* Opção 3: Motorista */}
          <button 
            disabled={isCheckingPassword}
            onClick={() => handleChooseAccess('driver')}
            className="group relative bg-slate-900/80 hover:bg-slate-900 backdrop-blur-xl p-3.5 sm:p-4 rounded-xl border border-slate-800 hover:border-cyan-500/60 text-left transition-all hover:shadow-lg hover:shadow-cyan-500/5 active:scale-[0.98] disabled:opacity-50 cursor-pointer flex flex-col justify-between min-h-[140px] sm:min-h-[180px]"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <Truck size={14} className="stroke-[2]" />
                </div>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-widest">
                  CAMPO
                </span>
              </div>

              <h2 className="text-xs sm:text-sm font-black text-white tracking-tight">
                Motorista
              </h2>
              <p className="text-slate-400 text-[10px] leading-normal mt-1">
                Entrega de água com fotos georreferenciadas.
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-bold text-cyan-400 group-hover:text-cyan-300 uppercase tracking-wider">
              <span>Iniciar Entregas</span>
              <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        </div>

        {/* Footer Info & Online Status */}
        <div className="text-center mt-6 space-y-2">
          {!isOnline && (
            <div className="bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-full text-[10px] font-bold border border-amber-500/20 inline-flex items-center gap-1.5 uppercase tracking-wider">
              <AlertCircle size={12} /> Modo Offline Ativo
            </div>
          )}
          {firebaseError && (
            <div className="bg-red-500/10 text-red-400 px-3 py-1.5 rounded-lg text-[10px] font-bold border border-red-500/20 max-w-xs mx-auto uppercase tracking-wider">
              {firebaseError}
            </div>
          )}
          {user && (
            <div className="pt-1 flex items-center justify-center gap-1.5 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>Conectado: <strong className="text-slate-200">{user.email}</strong></span>
              <span>•</span>
              <button 
                onClick={() => auth.signOut()} 
                className="text-red-400 hover:text-red-300 hover:underline font-semibold cursor-pointer"
              >
                Encerrar sessão
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Password Prompt Modal */}
      <AnimatePresence>
        {showPasswordPrompt && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[500] flex items-center justify-center p-3">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 16 }}
              className="bg-slate-900 p-4 sm:p-5 rounded-2xl w-full max-w-xs shadow-2xl border border-slate-800 max-h-[92dvh] overflow-y-auto space-y-3"
            >
              <div className="flex items-center justify-center mx-auto">
                <img 
                  src="/brasao-inhapi.svg" 
                  alt="Brasão da Prefeitura de Inhapi" 
                  className="w-16 h-16 object-contain drop-shadow-[0_4px_12px_rgba(255,255,255,0.18)]"
                  onError={(e) => { e.currentTarget.src = '/logo-inhapi.png'; }}
                />
              </div>
              
              <div className="text-center">
                <h3 className="text-sm font-black text-white tracking-tight uppercase">
                  {selectedAccess === 'admin' ? 'Acesso do Administrador' :
                   selectedAccess === 'secretary' ? 'Acesso do Secretário' :
                   'Acesso do Motorista'}
                </h3>
                <p className="text-slate-400 text-[10px] font-bold tracking-wider uppercase leading-normal mt-0.5">
                  {selectedAccess === 'admin' ? 'Digite a senha Administrador (Master).' :
                   selectedAccess === 'secretary' ? 'Digite a senha do Secretário.' :
                   'Digite a senha do Motorista.'}
                </p>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <input 
                    type={showPlainPassword ? "text" : "password"}
                    value={adminPassword}
                    onChange={(e) => {
                      setAdminPassword(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="Digite a senha"
                    className={`w-full bg-slate-950 border ${passwordError ? 'border-red-500' : 'border-slate-800'} focus:border-blue-500 outline-none rounded-lg py-2.5 pl-3 pr-10 text-white font-bold transition-all placeholder:text-slate-600 text-xs`}
                    onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPlainPassword(!showPlainPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer p-1"
                    title={showPlainPassword ? "Ocultar senha" : "Ver senha"}
                  >
                    {showPlainPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  {passwordError && (
                    <motion.div 
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-1 text-red-400 text-[10px] font-bold uppercase tracking-wider mt-1.5"
                    >
                      <AlertCircle size={12} /> {passwordError}
                    </motion.div>
                  )}
                </div>

                <div className="flex items-center justify-between px-0.5 text-[9px] font-bold uppercase tracking-wider">
                  {selectedAccess === 'admin' ? (
                    <button
                      type="button"
                      onClick={handleResetToDefaultPassword}
                      className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      Senha Padrão (123456)
                    </button>
                  ) : (
                    <div />
                  )}
                  <span className="text-slate-500">Inhapi/AL</span>
                </div>

                <button 
                  onClick={verifyPassword}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow-lg shadow-blue-600/25 text-xs uppercase tracking-wider cursor-pointer"
                >
                  <span>Entrar</span>
                  <ChevronRight size={14} />
                </button>

                <button 
                  onClick={() => {
                    setShowPasswordPrompt(false);
                    setSelectedAccess(null);
                    setAdminPassword('');
                    setPasswordError('');
                  }}
                  className="w-full text-slate-400 hover:text-slate-200 font-bold py-1 text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Voltar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
