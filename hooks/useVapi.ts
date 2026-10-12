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

export function useVapi(book: IBook) {
    const { userId } = useAuth();
    const { limits } = useSubscription();

    const [status, setStatus] = useState<CallStatus>('idle');
    const [messages, setMessages] = useState<Messages[]>([]);
    const [currentMessage, setCurrentMessage] = useState('');
    const [currentUserMessage, setCurrentUserMessage] = useState('');
    const [duration, setDuration] = useState(0);
    const [limitError, setLimitError] = useState<string | null>(null);
    const [isBillingError, setIsBillingError] = useState(false);

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const isStoppingRef = useRef(false);
    const recognitionRef = useRef<any>(null);
    const messagesRef = useLatestRef(messages);

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

    // Speak a sentence using SpeechSynthesis
    const speakText = useCallback((text: string, onEnd?: () => void) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            onEnd?.();
            return;
        }

        window.speechSynthesis.cancel(); // Stop any previous speech
        setStatus('speaking');
        setCurrentMessage(text);

        const utterance = new SpeechSynthesisUtterance(text);
        const voice = getBestVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            if (isStoppingRef.current) return;
            setCurrentMessage('');
            setMessages(prev => {
                const isDupe = prev.some(m => m.role === 'assistant' && m.content === text);
                return isDupe ? prev : [...prev, { role: 'assistant', content: text }];
            });
            onEnd?.();
        };

        utterance.onerror = (e) => {
            console.warn('SpeechSynthesis error:', e);
            if (!isStoppingRef.current) {
                setCurrentMessage('');
                onEnd?.();
            }
        };

        window.speechSynthesis.speak(utterance);
    }, [getBestVoice]);

    // Send user message to /api/chat and speak response
    const handleUserSpeech = useCallback(async (userText: string) => {
        if (!userText.trim() || isStoppingRef.current) return;

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
                    if (!isStoppingRef.current) {
                        startListening();
                    }
                });
            }
        } catch (err) {
            console.error('Chat error:', err);
            speakText("I had a little trouble finding that in the book. Could you try asking again?", () => {
                if (!isStoppingRef.current) {
                    startListening();
                }
            });
        }
    }, [book._id, book.persona, messagesRef, speakText]);

    // Start browser microphone speech recognition
    const startListening = useCallback(() => {
        if (isStoppingRef.current || typeof window === 'undefined') return;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setLimitError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
            setStatus('idle');
            return;
        }

        try {
            if (recognitionRef.current) {
                recognitionRef.current.abort();
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                if (!isStoppingRef.current) {
                    setStatus('listening');
                }
            };

            recognition.onresult = (event: any) => {
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

                if (final) {
                    recognition.stop();
                    handleUserSpeech(final);
                }
            };

            recognition.onerror = (event: any) => {
                if (event.error === 'no-speech') {
                    // Timeout with no speech -> restart listening if still active
                    if (!isStoppingRef.current && status === 'listening') {
                        setTimeout(() => startListening(), 500);
                    }
                } else if (event.error !== 'aborted') {
                    console.warn('Recognition error:', event.error);
                }
            };

            recognition.onend = () => {
                // If it ended naturally without final result and still supposed to listen
                if (!isStoppingRef.current && status === 'listening') {
                    setTimeout(() => startListening(), 300);
                }
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (e) {
            console.error('Failed to start recognition:', e);
        }
    }, [handleUserSpeech, status]);

    const stop = useCallback(() => {
        isStoppingRef.current = true;
        setStatus('idle');
        setCurrentMessage('');
        setCurrentUserMessage('');

        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch {}
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

            // Greet user and then start listening
            const greeting = `Hey, good to meet you! Have you read ${book.title} yet, or are we diving in for the first time?`;
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
