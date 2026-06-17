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
  const quaggaRef = useRef<any>(null);

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
              width: 640,
              height: 480,
              facingMode: 'environment',
            },
          },
          decoder: {
            readers: [
              'code_128_reader',
              'ean_reader',
              'ean_8_reader',
              'upc_reader',
              'upc_e_reader',
              'codabar_reader',
              'code_39_reader',
              'code_39_vin_reader',
              'code_93_reader',
            ],
            debug: {
              showCanvas: false,
              showPatches: false,
              showFoundPatches: false,
              showSkeleton: false,
              showLabels: false,
              showPatchLabels: false,
              showRemainingPatchLabels: false,
              boxFromPatches: null,
              showInputImage: false,
              showBinary: false,
              showPattern: false,
            },
          },
          locate: true,
          frequency: 10,
          numOfWorkers: 4,
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

            // Detect results
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
    if (result.codeResult.code) {
      const barcode = result.codeResult.code;
      setLastScan(barcode);

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      }

      onScanDetected(barcode);
    }
  };

  const stopCamera = () => {
    if (quaggaRef.current) {
      quaggaRef.current.stop();
      quaggaRef.current.offDetected(handleBarcodeDetected);
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
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80%',
            height: '60px',
            border: '3px solid transparent',
            borderRadius: '8px',
            transition: 'border-color 0.3s',
            pointerEvents: 'none',
          }}
        />
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
