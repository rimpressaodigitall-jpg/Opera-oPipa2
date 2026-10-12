import { useState, useEffect, useRef } from 'react';
import { Camera, RotateCw, X, MapPin, Calendar, User, ShieldAlert, ArrowLeft } from 'lucide-react';

interface CameraCarimboProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
  residentName: string;
  address: string;
  neighborhood: string;
  location: { lat: number; lng: number } | null;
}

export default function CameraCarimbo({
  onCapture,
  onClose,
  residentName,
  address,
  neighborhood,
  location
}: CameraCarimboProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Keep timestamp updated
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize camera stream
  useEffect(() => {
    let activeStream: MediaStream | null = null;

    async function startCamera() {
      try {
        setError(null);
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 960 }
          },
          audio: false
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = mediaStream;
        setStream(mediaStream);
        setHasPermission(true);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: any) {
        console.error("Error accessing camera: ", err);
        setHasPermission(false);
        setError("Não foi possível acessar a câmera. Verifique se deu permissão.");
      }
    }

    startCamera();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [facingMode]);

  const toggleFacingMode = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current || !stream) return;

    // Trigger visual flash feedback
    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 200);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Set canvas dimensions to match the raw video resolution (ensuring high resolution photo)
    const videoWidth = video.videoWidth || 1280;
    const videoHeight = video.videoHeight || 960;
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    // If using user/front camera, mirror the canvas image horizontally to match preview
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    // Draw the video frame to the canvas
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    // Reset mirroring transformation for drawing the watermark text normally
    if (facingMode === 'user') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Draw Stamp Watermark Overlay at the bottom
    const watermarkHeight = Math.round(videoHeight * 0.22); // 22% of height
    const yStart = videoHeight - watermarkHeight;

    // Draw semi-transparent background box for the stamp
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, yStart, videoWidth, watermarkHeight);

    // Draw a prominent brand side-stripe
    ctx.fillStyle = '#06b6d4'; // Cyan brand color
    ctx.fillRect(0, yStart, Math.round(videoWidth * 0.015), watermarkHeight);

    // Set fonts based on canvas size
    const baseFontSize = Math.round(videoWidth * 0.024); // responsive font size
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';

    // 1. Header: Brand info
    ctx.font = `bold ${Math.round(baseFontSize * 1.15)}px sans-serif`;
    ctx.fillText('🚚 OPERAÇÃO PIPA - PREFEITURA DE INHAPI - AL', Math.round(videoWidth * 0.04), yStart + Math.round(watermarkHeight * 0.12));

    // 2. Metadata text
    ctx.font = `bold ${baseFontSize}px sans-serif`;
    
    // Resident
    const formattedResident = `👤 MORADOR: ${(residentName || 'NÃO INFORMADO').toUpperCase()}`;
    ctx.fillText(formattedResident, Math.round(videoWidth * 0.04), yStart + Math.round(watermarkHeight * 0.35));

    // Hamlet/Sítio
    const formattedSitio = `📍 LOCALIDADE: ${(neighborhood || address || 'ZONA RURAL').toUpperCase()}`;
    ctx.fillText(formattedSitio, Math.round(videoWidth * 0.04), yStart + Math.round(watermarkHeight * 0.55));

    // Timestamp & GPS
    const formattedDate = `${currentTime.toLocaleDateString('pt-BR')} ${currentTime.toLocaleTimeString('pt-BR')}`;
    const formattedGPS = location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'SINAL GPS AUSENTE';
    const bottomLine = `📅 DATA: ${formattedDate}   |   🌐 GPS: ${formattedGPS}`;
    ctx.fillText(bottomLine, Math.round(videoWidth * 0.04), yStart + Math.round(watermarkHeight * 0.75));

    // Get base64 JPG image
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Stop camera and return
    stream.getTracks().forEach(track => track.stop());
    onCapture(dataUrl);
  };

  return (
    <div className="fixed inset-0 bg-black z-[2600] flex flex-col justify-between overflow-hidden">
      {/* Top Header Bar */}
      <div className="bg-slate-900/90 backdrop-blur-md px-4 py-3 flex justify-between items-center z-10 border-b border-white/10">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Câmera Carimbo</span>
          <span className="text-white text-xs font-bold uppercase tracking-tight truncate max-w-[180px]">
            {residentName || 'Finalizar entrega'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (stream) stream.getTracks().forEach(track => track.stop());
              onClose();
            }}
            className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold flex items-center gap-1 transition-colors active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={13} />
            <span>Voltar</span>
          </button>
          <button
            onClick={() => {
              if (stream) stream.getTracks().forEach(track => track.stop());
              onClose();
            }}
            className="w-9 h-9 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center transition-colors active:scale-95"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Video Area */}
      <div className="flex-1 relative z-0 flex items-center justify-center bg-slate-950">
        {hasPermission === null && (
          <div className="flex flex-col items-center justify-center text-center p-6 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
            <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Iniciando câmera segura...</p>
          </div>
        )}

        {hasPermission === false && (
          <div className="flex flex-col items-center justify-center text-center p-6 max-w-xs gap-4 bg-slate-900 border border-white/10 rounded-2xl">
            <ShieldAlert className="text-rose-500" size={48} />
            <div className="space-y-1">
              <h4 className="text-white font-extrabold text-sm uppercase">Sem acesso à Câmera</h4>
              <p className="text-slate-400 text-xs leading-normal">
                Verifique se o aplicativo tem permissões no seu navegador ou configurações do celular para capturar imagens.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-xs font-black uppercase tracking-wider"
            >
              Fechar Câmera
            </button>
          </div>
        )}

        {hasPermission === true && (
          <div className="w-full h-full relative flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
            />

            {/* Flash Overlay Effect */}
            {isFlashActive && (
              <div className="absolute inset-0 bg-white z-50 animate-none opacity-100" />
            )}

            {/* Live Stamp overlay (just a preview HUD so the driver sees what's being stamped) */}
            <div className="absolute bottom-4 left-4 right-4 bg-black/75 border-l-4 border-cyan-400 p-3 rounded-r-xl backdrop-blur-xs flex flex-col gap-1 z-10 select-none">
              <span className="text-[9px] font-black text-cyan-400 tracking-wider">📷 PRÉVIA DO CARIMBO</span>
              <span className="text-[10px] font-black text-white leading-none truncate">
                Morador: {(residentName || 'NÃO INFORMADO').toUpperCase()}
              </span>
              <span className="text-[9px] font-bold text-white/80 leading-none truncate">
                Local: {(neighborhood || address || 'ZONA RURAL').toUpperCase()}
              </span>
              <div className="flex items-center justify-between text-[8px] text-white/50 font-semibold pt-1 border-t border-white/10 mt-1">
                <span className="flex items-center gap-1">
                  <Calendar size={10} className="text-cyan-400" />
                  {currentTime.toLocaleDateString('pt-BR')} {currentTime.toLocaleTimeString('pt-BR')}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin size={10} className="text-cyan-400" />
                  {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : 'Sinal GPS buscando...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Shutter Controls */}
      <div className="bg-slate-950 px-6 py-6 sm:py-8 flex justify-between items-center z-10 border-t border-white/5 shrink-0">
        {/* Cancel Button */}
        <button
          onClick={() => {
            if (stream) stream.getTracks().forEach(track => track.stop());
            onClose();
          }}
          className="text-white/60 hover:text-white font-black text-[10px] uppercase tracking-widest px-4 py-2 hover:bg-white/5 rounded-xl transition-all"
        >
          Cancelar
        </button>

        {/* Capture Shutter Button */}
        <button
          onClick={handleCapture}
          disabled={!hasPermission}
          className="w-18 h-18 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:pointer-events-none rounded-full flex items-center justify-center p-1.5 transition-transform active:scale-90 shadow-2xl"
          title="Tirar Foto"
        >
          <div className="w-full h-full rounded-full border-2 border-slate-950 bg-white" />
        </button>

        {/* Rotate facingMode Button */}
        <button
          onClick={toggleFacingMode}
          disabled={!hasPermission}
          className="w-11 h-11 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:pointer-events-none text-white rounded-full flex items-center justify-center transition-all active:scale-90"
          title="Inverter Câmera"
        >
          <RotateCw size={18} />
        </button>
      </div>

      {/* Off-screen Canvas to render stamped final picture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
