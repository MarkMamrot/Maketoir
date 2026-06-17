'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    Quagga: any;
  }
}

interface BarcodeScannerProps {
  onScanDetected: (barcode: string) => void;
  isActive: boolean;
}

export default function BarcodeScanner({ onScanDetected, isActive }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState('Align the full barcode inside the guide');
  const quaggaRef = useRef<any>(null);
  const lastDetectedRef = useRef<{ code: string; ts: number } | null>(null);
  const candidateRef = useRef<{ code: string; count: number; ts: number } | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const guideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGuideColor = useRef<'white' | 'yellow' | 'green'>('white');

  // Load Quagga.js library
  useEffect(() => {
    if (!isActive) return;

    const loadQuagga = async () => {
      if (window.Quagga) {
        initializeQuagga();
        return;
      }

      // Load script dynamically
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/quagga@0.12.1/dist/quagga.min.js';
      script.onload = () => {
        initializeQuagga();
      };
      script.onerror = () => {
        console.error('Failed to load Quagga');
        setManualMode(true);
      };
      document.body.appendChild(script);
    };

    loadQuagga();

    return () => {
      stopCamera();
    };
  }, [isActive]);

  const setGuideColor = (color: 'white' | 'yellow' | 'green') => {
    const el = guideRef.current;
    if (!el) return;
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current);
    lastGuideColor.current = color;
    if (color === 'green') {
      el.style.borderColor = '#00e676';
      el.style.borderWidth = '5px';
      el.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.25), 0 0 28px 10px rgba(0,230,118,0.55)';
      guideTimerRef.current = setTimeout(() => setGuideColor('white'), 900);
    } else if (color === 'yellow') {
      el.style.borderColor = '#ffe57f';
      el.style.borderWidth = '4px';
      el.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.18)';
    } else {
      el.style.borderColor = 'rgba(255,255,255,0.95)';
      el.style.borderWidth = '3px';
      el.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.18)';
    }
  };

  const initializeQuagga = async () => {
    if (!containerRef.current) return;

    try {
      // Request camera permission
      await navigator.mediaDevices.getUserMedia({ video: true });

      window.Quagga.init(
        {
          inputStream: {
            name: 'Live',
            type: 'LiveStream',
            target: containerRef.current,
            constraints: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: 'environment' },
              advanced: [{ focusMode: 'continuous' }],
            },
          },
          locator: {
            patchSize: 'medium',
            halfSample: true,
          },
          decoder: {
            readers: [
              'code_128_reader',
              'ean_reader',
              'ean_8_reader',
              'upc_reader',
              'upc_e_reader',
            ],
          },
          locate: true,
          frequency: 10,
          numOfWorkers: 2,
          multiple: false,
        },
        (err: any) => {
          if (err) {
            console.error('Quagga initialization error:', err);
            setManualMode(true);
          } else {
            window.Quagga.start();
            quaggaRef.current = window.Quagga;
            setCameraActive(true);

            // Colour the guide box when a barcode is visible in the frame
            window.Quagga.onProcessed((result: any) => {
              if (result?.codeResult?.code) {
                if (lastGuideColor.current === 'white') setGuideColor('yellow');
              } else {
                if (lastGuideColor.current === 'yellow') setGuideColor('white');
              }
            });

            window.Quagga.onDetected(handleBarcodeDetected);
          }
        }
      );
    } catch (err) {
      console.error('Camera permission denied:', err);
      setManualMode(true);
    }
  };

  const handleBarcodeDetected = (result: any) => {
    const barcode = String(result?.codeResult?.code || '').trim();
    if (!barcode || barcode.length < 6) return;

    const now = Date.now();
    const candidate = candidateRef.current;
    if (candidate && candidate.code === barcode && now - candidate.ts < 1500) {
      candidateRef.current = { code: barcode, count: candidate.count + 1, ts: now };
    } else {
      candidateRef.current = { code: barcode, count: 1, ts: now };
      setScanHint('Keep still — reading barcode...');
      return;
    }

    if (candidateRef.current.count < 2) {
      setScanHint('Keep still — reading barcode...');
      return;
    }

    // Prevent duplicates fired in rapid succession
    const last = lastDetectedRef.current;
    if (last && last.code === barcode && now - last.ts < 1200) return;
    lastDetectedRef.current = { code: barcode, ts: now };
    candidateRef.current = null;

    setLastScan(barcode);
    setScanHint('Scan captured!');
    setGuideColor('green');

    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

    onScanDetected(barcode);
  };

  const stopCamera = () => {
    if (guideTimerRef.current) clearTimeout(guideTimerRef.current);
    if (quaggaRef.current) {
      try { quaggaRef.current.offProcessed(); } catch { /* no-op */ }
      try { quaggaRef.current.offDetected(handleBarcodeDetected); } catch { /* no-op */ }
      try { quaggaRef.current.stop(); } catch { /* no-op */ }
    }
    setCameraActive(false);
  };

  const handleManualEntry = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const barcode = (formData.get('barcode') as string).trim();
    if (barcode) {
      setLastScan(barcode);
      onScanDetected(barcode);
      e.currentTarget.reset();
    }
  };

  if (manualMode) {
    return (
      <div
        style={{
          padding: '16px',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          margin: '16px',
        }}
      >
        <form onSubmit={handleManualEntry}>
          <label
            style={{
              display: 'block',
              fontSize: '14px',
              color: '#666',
              marginBottom: '8px',
            }}
          >
            Camera unavailable. Enter barcode manually:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              name="barcode"
              placeholder="Scan or type barcode..."
              style={{
                flex: 1,
                height: '44px',
                padding: '0 12px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '6px',
              }}
              autoFocus
            />
            <button
              type="submit"
              style={{
                height: '44px',
                padding: '0 16px',
                fontSize: '16px',
                backgroundColor: '#0066cc',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              Add
            </button>
          </div>
        </form>
        {lastScan && (
          <div
            style={{
              marginTop: '12px',
              padding: '12px',
              backgroundColor: '#e6f2ff',
              color: '#0066cc',
              borderRadius: '6px',
              fontSize: '14px',
          }}
          >
            Last scan: {lastScan}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '40vh',
        backgroundColor: '#000',
        overflow: 'hidden',
        borderBottom: '2px solid #ddd',
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      {!cameraActive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>📷</div>
            <p>Starting camera...</p>
          </div>
        </div>
      )}

      {cameraActive && (
        <div
          ref={guideRef}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '84%',
            height: '72px',
            borderStyle: 'solid',
            borderWidth: '3px',
            borderColor: 'rgba(255,255,255,0.95)',
            borderRadius: '8px',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
          }}
        />
      )}

      {cameraActive && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(50% + 52px)',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '12px',
            color: '#fff',
            backgroundColor: 'rgba(0,0,0,0.55)',
            padding: '6px 10px',
            borderRadius: '999px',
            maxWidth: '92%',
            textAlign: 'center',
          }}
        >
          {scanHint}
        </div>
      )}

      {lastScan && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            right: '16px',
            padding: '8px 12px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          ✓ Scanned: {lastScan}
        </div>
      )}
    </div>
  );
}
