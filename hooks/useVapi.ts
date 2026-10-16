'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSubscription } from '@/hooks/useSubscription';
import { IBook, Messages } from '@/types';
import { startVoiceSession, endVoiceSession } from '@/lib/actions/session.actions';

export type CallStatus = 'idle' | 'connecting' | 'starting' | 'listening' | 'thinking' | 'speaking';

export function useLatestRef<T>(value: T) {
    const ref = useRef(value);
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref;
}

export function useVapi(book: IBook, initialMessages: Messages[] = []) {
    const { userId } = useAuth();
    const { limits } = useSubscription();

    const [status, setStatus] = useState<CallStatus>('idle');
    const [messages, setMessages] = useState<Messages[]>(initialMessages);
    const [currentMessage, setCurrentMessage] = useState('');
    const [currentUserMessage, setCurrentUserMessage] = useState('');
    const [duration, setDuration] = useState(0);
    const [limitError, setLimitError] = useState<string | null>(null);
    const [isBillingError, setIsBillingError] = useState(false);

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const isStoppingRef = useRef(false);
    const isSpeakingRef = useRef(false);
    const recognitionRef = useRef<any>(null);
    const activeUtterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
    const messagesRef = useLatestRef(messages);
    const statusRef = useLatestRef(status);

    const maxDurationSeconds = limits?.maxDurationPerSession ? limits.maxDurationPerSession * 60 : 15 * 60;
    const maxDurationRef = useLatestRef(maxDurationSeconds);
    const durationRef = useLatestRef(duration);

    // Pick best matching browser voice for the selected persona
    const getBestVoice = useCallback(() => {
        if (typeof window === 'undefined' || !window.speechSynthesis) return null;
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return null;

        const isFemale = book.persona === 'rachel' || book.persona === 'sarah';
        const preferred = voices.find(v =>
            v.lang.startsWith('en') &&
            (isFemale
                ? /samantha|victoria|karen|female|zira/i.test(v.name)
                : /daniel|alex|george|male|david|oliver/i.test(v.name))
        );

        return preferred || voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
    }, [book.persona]);

    // Speak sentences using SpeechSynthesis queue (prevents Chrome GC bug and 14s stall)
    const speakText = useCallback((text: string, onEnd?: () => void) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            onEnd?.();
            return;
        }

        // 1. Mark speaking state and strictly disable recognition so microphone never hears speakers
        isSpeakingRef.current = true;
        if (recognitionRef.current) {
            try {
                recognitionRef.current.onend = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.abort();
            } catch {}
            recognitionRef.current = null;
        }

        window.speechSynthesis.cancel();
        activeUtterancesRef.current = [];

        setStatus('speaking');
        setCurrentMessage(text);

        // 2. Break into natural sentences to avoid Chrome speech pause/stall bug
        const sentences = text
            .match(/[^.!?]+[.!?]+|\S[^.!?]*$/g)
            ?.map(s => s.trim())
            .filter(Boolean) || [text];

        let index = 0;
        const voice = getBestVoice();

        const speakNext = () => {
            if (isStoppingRef.current || !isSpeakingRef.current) return;

            if (index >= sentences.length) {
                // All sentences completed
                isSpeakingRef.current = false;
                activeUtterancesRef.current = [];
                (window as any).__activeUtterance = null;
                setCurrentMessage('');
                setMessages(prev => {
                    const isDupe = prev.some(m => m.role === 'assistant' && m.content === text);
                    return isDupe ? prev : [...prev, { role: 'assistant', content: text }];
                });

                // Wait 400ms for room echo / speaker reverb to dissipate before opening mic
                setTimeout(() => {
                    if (!isStoppingRef.current && !isSpeakingRef.current) {
                        onEnd?.();
                    }
                }, 400);
                return;
            }

            const sentence = sentences[index];
            index++;

            const utterance = new SpeechSynthesisUtterance(sentence);
            if (voice) utterance.voice = voice;
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            // Retain reference to prevent Chrome garbage-collection pause
            activeUtterancesRef.current.push(utterance);
            (window as any).__activeUtterance = utterance;

            utterance.onend = () => {
                if (isStoppingRef.current) return;
                speakNext();
            };

            utterance.onerror = (e) => {
                console.warn('SpeechSynthesis sentence error:', e);
                if (!isStoppingRef.current) {
                    speakNext();
                }
            };

            window.speechSynthesis.speak(utterance);
        };

        speakNext();
    }, [getBestVoice]);

    // Send user message to /api/chat and speak response
    const handleUserSpeech = useCallback(async (userText: string) => {
        if (!userText.trim() || isStoppingRef.current) return;

        // Disconnect speech recognition while thinking and generating answer
        if (recognitionRef.current) {
            try {
                recognitionRef.current.onend = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.abort();
            } catch {}
            recognitionRef.current = null;
        }

        setStatus('thinking');
        setCurrentUserMessage('');
        setMessages(prev => [...prev, { role: 'user', content: userText }]);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookId: book._id,
                    message: userText,
                    history: messagesRef.current,
                    persona: book.persona,
                }),
            });

            if (!res.ok) throw new Error('Failed to get companion reply');

            const data = await res.json();
            const reply = data.reply || "I'm here! What else would you like to explore about the book?";

            if (!isStoppingRef.current) {
                speakText(reply, () => {
                    if (!isStoppingRef.current && !isSpeakingRef.current) {
                        startListening();
                    }
                });
            }
        } catch (err) {
            console.error('Chat error:', err);
            speakText("I had a little trouble finding that in the book. Could you try asking again?", () => {
                if (!isStoppingRef.current && !isSpeakingRef.current) {
                    startListening();
                }
            });
        }
    }, [book._id, book.persona, messagesRef, speakText]);

    // Start browser microphone speech recognition
    const startListening = useCallback(() => {
        if (isStoppingRef.current || isSpeakingRef.current || typeof window === 'undefined') return;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setLimitError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
            setStatus('idle');
            return;
        }

        try {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.onend = null;
                    recognitionRef.current.onerror = null;
                    recognitionRef.current.abort();
                } catch {}
                recognitionRef.current = null;
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                if (!isStoppingRef.current && !isSpeakingRef.current) {
                    setStatus('listening');
                }
            };

            recognition.onresult = (event: any) => {
                if (isSpeakingRef.current || isStoppingRef.current) return;

                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (interim) {
                    setCurrentUserMessage(interim);
                }

                if (final.trim()) {
                    try {
                        recognition.onend = null;
                        recognition.onerror = null;
                        recognition.stop();
                    } catch {}
                    handleUserSpeech(final.trim());
                }
            };

            recognition.onerror = (event: any) => {
                if (isSpeakingRef.current || isStoppingRef.current) return;
                if (event.error === 'no-speech') {
                    // Timeout with no speech -> restart listening if still active
                    if (!isStoppingRef.current && !isSpeakingRef.current) {
                        setTimeout(() => startListening(), 400);
                    }
                } else if (event.error !== 'aborted') {
                    console.warn('Recognition error:', event.error);
                }
            };

            recognition.onend = () => {
                // If it ended naturally without final result and we are still in listening state
                if (!isStoppingRef.current && !isSpeakingRef.current && statusRef.current === 'listening') {
                    setTimeout(() => startListening(), 400);
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (e) {
            console.error('Failed to start recognition:', e);
        }
    }, [handleUserSpeech, statusRef]);

    const stop = useCallback(() => {
        isStoppingRef.current = true;
        isSpeakingRef.current = false;
        setStatus('idle');
        setCurrentMessage('');
        setCurrentUserMessage('');

        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            activeUtterancesRef.current = [];
            (window as any).__activeUtterance = null;
        }

        if (recognitionRef.current) {
            try {
                recognitionRef.current.onend = null;
                recognitionRef.current.onerror = null;
                recognitionRef.current.abort();
            } catch {}
            recognitionRef.current = null;
        }

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (sessionIdRef.current) {
            endVoiceSession(sessionIdRef.current, durationRef.current).catch(console.error);
            sessionIdRef.current = null;
        }
    }, [durationRef]);

    const start = useCallback(async () => {
        if (!userId) {
            setLimitError('Please sign in to start a voice session.');
            return;
        }

        setLimitError(null);
        setIsBillingError(false);
        isStoppingRef.current = false;
        setStatus('starting');

        try {
            // Track session in MongoDB
            const result = await startVoiceSession(userId, book._id);
            if (!result.success) {
                setLimitError(result.error || 'Failed to start voice session.');
                setStatus('idle');
                return;
            }

            sessionIdRef.current = result.sessionId || null;

            // Start timer
            startTimeRef.current = Date.now();
            setDuration(0);
            timerRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                    setDuration(elapsed);

                    if (elapsed >= maxDurationRef.current) {
                        stop();
                        setLimitError('Session time limit reached. Click the mic to start again.');
                    }
                }
            }, 1000);

            // Greet user based on whether they have previous conversation history
            const hasHistory = messagesRef.current.length > 0;
            const greeting = hasHistory
                ? `Welcome back to ${book.title}! What would you like to explore next?`
                : `Hey, good to meet you! Have you read ${book.title} yet, or are we diving in for the first time?`;

            speakText(greeting, () => {
                if (!isStoppingRef.current) {
                    startListening();
                }
            });
        } catch (err) {
            console.error('Failed to start session:', err);
            setStatus('idle');
            setLimitError('Could not start voice session. Please try again.');
        }
    }, [book._id, book.title, maxDurationRef, speakText, startListening, stop, userId]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stop();
        };
    }, [stop]);

    const clearError = useCallback(() => {
        setLimitError(null);
        setIsBillingError(false);
    }, []);

    const isActive =
        status === 'starting' ||
        status === 'listening' ||
        status === 'thinking' ||
        status === 'speaking';

    return {
        status,
        isActive,
        messages,
        currentMessage,
        currentUserMessage,
        duration,
        start,
        stop,
        limitError,
        isBillingError,
        maxDurationSeconds,
        clearError,
    };
}

export default useVapi;
