import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Mic,
  MicOff,
  Minus,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { formatMoney } from '../shared/calculations.ts';
import type {
  MenuItemDTO,
  RestaurantDTO,
  VoiceOrderParseResponseDTO,
  VoiceParsedItemDTO,
} from '../shared/types.ts';

interface VoiceOrderingModalProps {
  open: boolean;
  onClose: () => void;
  restaurant: RestaurantDTO;
  sessionToken: string;
  menuItems: MenuItemDTO[];
  onConfirmAddToCart: (
    items: {
      menuItem: MenuItemDTO;
      quantity: number;
      variantName: string;
      spiceLevel: 'Mild' | 'Medium' | 'Hot';
      specialInstructions: string;
    }[]
  ) => void;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const LANGUAGE_OPTIONS = [
  { code: 'en-IN', label: 'English / Hinglish' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)' },
  { code: 'mr-IN', label: 'Marathi (मराठी)' },
];

export const VoiceOrderingModal: React.FC<VoiceOrderingModalProps> = ({
  open,
  onClose,
  restaurant,
  sessionToken,
  menuItems,
  onConfirmAddToCart,
}) => {
  const samplePhrases = useMemo(() => {
    const avail = menuItems.filter((m) => m.isAvailable);
    if (avail.length >= 2) {
      const a = avail[0].name;
      const b = avail[1].name;
      const c = avail[Math.min(2, avail.length - 1)].name;
      return [
        `Two ${a} and one ${b}`,
        `Ek ${b} aur do ${c}, less spicy`,
        `Don ${a} ani ek ${b} dya`,
      ];
    }
    if (avail.length === 1) {
      return [`Two ${avail[0].name}, medium spice`, `Ek ${avail[0].name}`];
    }
    return ['Two signature mains and one drink'];
  }, [menuItems]);
  const [language, setLanguage] = useState('en-IN');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [micError, setMicError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<VoiceOrderParseResponseDTO | null>(null);
  const [reviewedItems, setReviewedItems] = useState<VoiceParsedItemDTO[]>([]);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    setSpeechSupported(Boolean(Ctor));
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore cleanup errors
      }
    };
  }, []);

  if (!open) return null;

  const startListening = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechSupported(false);
      setMicError('Live browser microphone recognition is unsupported here — please type your spoken order below.');
      return;
    }

    setMicError('');
    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let combined = '';
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0]?.transcript || '';
      }
      setTranscript(combined.trim());
    };

    rec.onerror = (event) => {
      setMicError(
        event.error === 'not-allowed'
          ? 'Microphone permission denied. You can allow mic access or type your order below.'
          : `Speech capture issue (${event.error}). You can edit or type your order directly.`
      );
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMicError('Could not start microphone capture. Please type your order below.');
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Ignore
    }
    setListening(false);
  };

  const handleInterpretOrder = async () => {
    if (!transcript.trim()) return;
    stopListening();
    setParsing(true);
    setMicError('');
    try {
      const res = await apiFetch<VoiceOrderParseResponseDTO>('/api/ai/voice-parse', {
        method: 'POST',
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableSessionToken: sessionToken,
          language,
          transcript: transcript.trim(),
        }),
      });
      setParseResult(res);
      setReviewedItems(res.items);
    } catch (err: unknown) {
      setMicError(err instanceof Error ? err.message : 'Unable to parse spoken order.');
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    const valid = reviewedItems
      .filter((it) => it.isAvailable && it.menuItemId !== null && it.quantity > 0)
      .map((it) => {
        const menuItem = menuItems.find((m) => m.id === it.menuItemId);
        if (!menuItem) return null;
        return {
          menuItem,
          quantity: it.quantity,
          variantName: it.variantName,
          spiceLevel: it.spiceLevel,
          specialInstructions: it.specialInstructions,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (valid.length === 0) return;

    if (parseResult?.voiceSessionId) {
      apiFetch(`/api/ai/voice-sessions/${parseResult.voiceSessionId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'confirmed' }),
      }).catch(() => {});
    }

    onConfirmAddToCart(valid);
    setParseResult(null);
    setReviewedItems([]);
    setTranscript('');
    onClose();
  };

  const confirmedTotalCents = reviewedItems
    .filter((i) => i.isAvailable && i.menuItemId !== null)
    .reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" />
              Multilingual Voice Ordering
            </p>
            <h3 className="text-lg font-display font-bold text-stone-900 mt-0.5">
              Speak Your Order Naturally
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Supports English, Hindi, Marathi &amp; mixed phrases. Always reviewed before adding to cart.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopListening();
              onClose();
            }}
            className="p-2 rounded-lg text-stone-500 hover:bg-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Language + Mic Trigger */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FAF8F5] rounded-2xl border border-stone-200 p-4">
          <div>
            <label className="block text-[11px] font-semibold text-stone-600 mb-1">
              Spoken Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-medium"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-xs font-semibold transition-colors min-h-[44px] ${
              listening
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {listening ? (
              <>
                <MicOff className="w-4 h-4" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                {speechSupported ? 'Tap to Speak' : 'Mic Unavailable (Type Below)'}
              </>
            )}
          </button>
        </div>

        {/* Audio Waveform Visualization while Listening */}
        {listening && (
          <div className="flex items-center justify-center gap-1.5 py-2 bg-orange-50 rounded-xl border border-orange-200">
            {[1, 2, 3, 4, 5, 6, 7].map((bar) => (
              <span
                key={bar}
                className="w-1.5 rounded-full bg-orange-600 animate-pulse"
                style={{ height: `${12 + ((bar * 7) % 20)}px` }}
              />
            ))}
            <span className="ml-2 text-xs font-semibold text-orange-800">
              Listening ({language})...
            </span>
          </div>
        )}

        {/* Editable Transcript Box + Manual Fallback */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 mb-1.5">
            Live Transcript (Edit or Type Manually)
          </label>
          <textarea
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={`Example: "${samplePhrases[0]}"`}
            className="w-full rounded-xl border border-stone-300 p-3 text-sm focus:outline-none focus:border-orange-600"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {samplePhrases.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => {
                  setTranscript(phrase);
                  setMicError('');
                }}
                className="text-[11px] rounded-lg border border-stone-200 bg-[#FAF8F5] px-2.5 py-1 text-stone-600 hover:border-orange-400 text-left"
              >
                &ldquo;{phrase}&rdquo;
              </button>
            ))}
          </div>
        </div>

        {micError && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
            <span>{micError}</span>
          </div>
        )}

        <button
          type="button"
          disabled={parsing || !transcript.trim()}
          onClick={handleInterpretOrder}
          className="w-full rounded-xl bg-stone-900 py-3 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {parsing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Matching Against Live Menu...
            </>
          ) : (
            'Interpret Spoken Order'
          )}
        </button>

        {/* Parsed Order Confirmation Review */}
        {parseResult && (
          <div className="rounded-2xl border border-stone-200 bg-[#FAF8F5] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-stone-900">
                Confirm Interpreted Dishes
              </h4>
              <span className="font-mono tabular-nums text-sm font-bold text-stone-900">
                {formatMoney(confirmedTotalCents, restaurant.currencySymbol)}
              </span>
            </div>

            {parseResult.ambiguities.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                {parseResult.ambiguities.map((amb, i) => (
                  <p key={i}>• {amb}</p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {reviewedItems.map((it, idx) => (
                <div
                  key={`${it.spokenPhrase}-${idx}`}
                  className="rounded-xl bg-white border border-stone-200 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-stone-900 truncate">
                      {it.matchedItemName}
                    </p>
                    <p className="text-[11px] text-stone-500">
                      {it.variantName} · {it.spiceLevel}
                      {it.specialInstructions && ` · ${it.specialInstructions}`}
                      {!it.isAvailable && ' · Unavailable'}
                    </p>
                  </div>

                  {it.isAvailable && it.menuItemId ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center gap-1 border border-stone-200 rounded-lg px-1 py-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setReviewedItems((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x
                              )
                            )
                          }
                          className="p-1"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono tabular-nums text-xs font-semibold w-5 text-center">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setReviewedItems((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, quantity: x.quantity + 1 } : x))
                            )
                          }
                          className="p-1"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-semibold w-14 text-right">
                        {formatMoney(it.unitPriceCents * it.quantity, restaurant.currencySymbol)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setReviewedItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-stone-400 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-semibold text-red-600">Review / Unmatched</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setParseResult(null);
                  setReviewedItems([]);
                }}
                className="rounded-xl border border-stone-300 px-4 py-2.5 text-xs font-semibold text-stone-700"
              >
                Re-speak
              </button>
              <button
                type="button"
                disabled={
                  reviewedItems.filter((i) => i.isAvailable && i.menuItemId !== null).length === 0
                }
                onClick={handleConfirm}
                className="flex-1 rounded-xl bg-orange-600 py-2.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <ShoppingBag className="w-3.5 h-3.5" />
                Confirm &amp; Add to Table Cart
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
